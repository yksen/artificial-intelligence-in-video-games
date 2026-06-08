import type { Bot } from "mineflayer";
import { definePhase } from "../step.js";
import { logger } from "../logger.js";
import { RESOURCE_TARGETS } from "../config.js";
import { countItem, hasItem } from "../utils/inventory.js";
import { craftItem } from "../utils/crafting.js";
import { findBlockByNames, goToPosition, sleep } from "../utils/navigation.js";

const EYES_WANTED = RESOURCE_TARGETS.eyesOfEnder;

export const eyesOfEnderPhase = definePhase({
  name: "Eyes of Ender",

  canSkip: ({ bot }) => countItem(bot, "ender_eye") >= 12 && (bot.game as any).dimension === "overworld",

  steps: () => [
    {
      name: "Grind blaze rods into powder",
      isDone: ({ bot }) =>
        countItem(bot, "ender_eye") + countItem(bot, "blaze_powder") >= EYES_WANTED || !hasItem(bot, "blaze_rod"),
      run: async ({ bot, log }) => {
        const needed = EYES_WANTED - countItem(bot, "ender_eye") - countItem(bot, "blaze_powder");
        const rodsToGrind = Math.min(countItem(bot, "blaze_rod"), Math.ceil(needed / 2));
        try {
          await craftItem(bot, "blaze_powder", rodsToGrind);
          log.info(`Crafted blaze powder from ${rodsToGrind} rods`);
        } catch (err) {
          log.warn(`Failed to craft blaze powder: ${err}`);
        }
      },
    },
    {
      name: "Craft eyes of ender",
      isDone: ({ bot }) => countItem(bot, "ender_eye") >= EYES_WANTED,
      run: async ({ bot, log }) => {
        const canMake = Math.min(
          countItem(bot, "blaze_powder"),
          countItem(bot, "ender_pearl"),
          EYES_WANTED - countItem(bot, "ender_eye"),
        );
        if (canMake <= 0) return;
        try {
          await craftItem(bot, "ender_eye", canMake);
          log.info(`Crafted ${canMake} eyes of ender (total ${countItem(bot, "ender_eye")})`);
        } catch (err) {
          log.warn(`Failed to craft eyes of ender: ${err}`);
        }
      },
    },
    {
      name: "Verify 12 eyes",
      run: async ({ bot }) => {
        if (countItem(bot, "ender_eye") < 12) {
          throw new Error(`Only have ${countItem(bot, "ender_eye")} eyes of ender; need 12`);
        }
      },
    },
    {
      name: "Return to the overworld",
      isDone: ({ bot }) => (bot.game as any).dimension === "overworld",
      run: async ({ bot }) => {
        if ((bot.game as any).dimension === "the_nether") await returnToOverworld(bot);
        if ((bot.game as any).dimension !== "overworld") {
          throw new Error("Failed to return to the overworld from the Nether");
        }
      },
    },
  ],
});

async function returnToOverworld(bot: Bot): Promise<void> {
  logger.info("Returning to the overworld via the nether portal");

  const home = (bot as any).__netherHome as { x: number; y: number; z: number } | undefined;
  const startDim = (bot.game as any).dimension;
  const deadline = Date.now() + 90_000;

  while ((bot.game as any).dimension === startDim && Date.now() < deadline) {
    let portal = findBlockByNames(bot, ["nether_portal"], 48);
    if (!portal && home) {
      try {
        await goToPosition(bot, home, 2);
      } catch {
      }
      portal = findBlockByNames(bot, ["nether_portal"], 48);
    }

    if (portal) {
      try {
        await goToPosition(bot, portal.position, 0);
      } catch {
      }
      await sleep(4000);
    } else {
      logger.warn("No nether portal in range to return through");
      await sleep(1000);
      break;
    }
  }

  if ((bot.game as any).dimension !== startDim) {
    logger.info(`Dimension changed to ${(bot.game as any).dimension}`);
  }
}
