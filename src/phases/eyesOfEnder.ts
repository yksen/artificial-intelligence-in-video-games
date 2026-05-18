import type { Bot } from "mineflayer";
import type { Phase } from "./types.js";
import { logger } from "../logger.js";
import { RESOURCE_TARGETS } from "../config.js";
import { countItem, hasItem } from "../utils/inventory.js";
import { craftItem } from "../utils/crafting.js";
import { findBlockByNames, goToPosition, sleep } from "../utils/navigation.js";

export const eyesOfEnderPhase: Phase = {
  name: "Eyes of Ender",

  canSkip(bot: Bot): boolean {
    return countItem(bot, "ender_eye") >= 12 && (bot.game as any).dimension === "overworld";
  },

  async execute(bot: Bot): Promise<void> {
    logger.info("=== Phase 8: Eyes of Ender ===");

    const eyesWanted = RESOURCE_TARGETS.eyesOfEnder;
    let powder = countItem(bot, "blaze_powder");
    const eyes = countItem(bot, "ender_eye");
    const powderNeeded = Math.max(0, eyesWanted - eyes - powder);
    if (powderNeeded > 0 && hasItem(bot, "blaze_rod")) {
      const rodsToGrind = Math.min(countItem(bot, "blaze_rod"), Math.ceil(powderNeeded / 2));
      try {
        await craftItem(bot, "blaze_powder", rodsToGrind);
        logger.info(`Crafted blaze powder from ${rodsToGrind} rods`);
      } catch (err) {
        logger.warn(`Failed to craft blaze powder: ${err}`);
      }
    }

    powder = countItem(bot, "blaze_powder");
    const pearls = countItem(bot, "ender_pearl");
    const canMake = Math.min(powder, pearls, eyesWanted - countItem(bot, "ender_eye"));
    if (canMake > 0) {
      try {
        await craftItem(bot, "ender_eye", canMake);
        logger.info(`Crafted ${canMake} eyes of ender (total ${countItem(bot, "ender_eye")})`);
      } catch (err) {
        logger.warn(`Failed to craft eyes of ender: ${err}`);
      }
    }

    if (countItem(bot, "ender_eye") < 12) {
      throw new Error(`Only have ${countItem(bot, "ender_eye")} eyes of ender; need 12`);
    }

    if ((bot.game as any).dimension === "the_nether") {
      await returnToOverworld(bot);
    }

    if ((bot.game as any).dimension !== "overworld") {
      throw new Error("Failed to return to the overworld from the Nether");
    }

    logger.info("Phase 8 complete: eyes of ender ready, back in the overworld");
  },
};

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
