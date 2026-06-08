import { definePhase } from "../step.js";
import { RESOURCE_TARGETS } from "../config.js";
import { countItem, hasItem, hasPickaxeTier } from "../utils/inventory.js";
import { findAndMineBlocks } from "../utils/mining.js";
import { craftItem, ensureItem } from "../utils/crafting.js";

export const stoneAgePhase = definePhase({
  name: "Stone Age",

  canSkip({ bot, mcData }) {
    const furnaceId = mcData.blocksByName["furnace"]?.id;
    const hasFurnace =
      hasItem(bot, "furnace") ||
      (furnaceId !== undefined && bot.findBlock({ matching: furnaceId, maxDistance: 32 }) !== null);
    return hasPickaxeTier(bot, "stone") && hasFurnace;
  },

  steps: () => [
    {
      name: "Mine cobblestone",
      isDone: ({ bot }) => countItem(bot, "cobblestone") >= RESOURCE_TARGETS.cobblestone,
      run: async ({ bot, log }) => {
        const needed = RESOURCE_TARGETS.cobblestone - countItem(bot, "cobblestone");
        const mined = await findAndMineBlocks(bot, "stone", needed);
        log.info(`Mined ${mined} stone (drops as cobblestone)`);
      },
    },
    {
      name: "Ensure sticks",
      isDone: ({ bot }) => countItem(bot, "stick") >= 4,
      run: ({ bot }) => ensureItem(bot, "stick", 8),
    },
    {
      name: "Craft stone pickaxe",
      isDone: ({ bot }) => hasPickaxeTier(bot, "stone"),
      run: ({ bot }) => craftItem(bot, "stone_pickaxe", 1),
    },
    {
      name: "Craft stone sword",
      isDone: ({ bot }) => hasItem(bot, "stone_sword") || hasItem(bot, "iron_sword"),
      run: async ({ bot, log }) => {
        try {
          await craftItem(bot, "stone_sword", 1);
        } catch {
          log.debug("Couldn't craft stone sword");
        }
      },
    },
    {
      name: "Craft furnace",
      isDone: ({ bot }) => hasItem(bot, "furnace"),
      run: async ({ bot, log }) => {
        const cobbleCount = countItem(bot, "cobblestone");
        if (cobbleCount < 8) {
          await findAndMineBlocks(bot, "stone", 8 - cobbleCount);
        }
        await craftItem(bot, "furnace", 1);
        log.info("Crafted furnace");
      },
    },
  ],
});
