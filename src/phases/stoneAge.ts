import type { Bot } from "mineflayer";
import type { Phase } from "./types.js";
import { logger } from "../logger.js";
import { RESOURCE_TARGETS } from "../config.js";
import { countItem, hasItem, hasPickaxeTier } from "../utils/inventory.js";
import { findAndMineBlocks } from "../utils/mining.js";
import { craftItem, ensureItem } from "../utils/crafting.js";

export const stoneAgePhase: Phase = {
  name: "Stone Age",

  canSkip(bot: Bot): boolean {
    const hasStonePickaxe = hasPickaxeTier(bot, "stone");
    const hasFurnace = hasItem(bot, "furnace") ||
      (require("minecraft-data")(bot.version) &&
        bot.findBlock({
          matching: require("minecraft-data")(bot.version).blocksByName["furnace"]?.id,
          maxDistance: 32,
        }) !== null);
    return hasStonePickaxe && hasFurnace;
  },

  async execute(bot: Bot): Promise<void> {
    logger.info("=== Phase 2: Stone Age ===");

    const currentCobble = countItem(bot, "cobblestone");
    const needed = RESOURCE_TARGETS.cobblestone - currentCobble;

    if (needed > 0) {
      logger.info(`Need to mine ${needed} more cobblestone`);
      const mined = await findAndMineBlocks(bot, "stone", needed);
      logger.info(`Mined ${mined} stone (drops as cobblestone)`);
    }

    await ensureItem(bot, "stick", 8);

    if (!hasPickaxeTier(bot, "stone")) {
      await craftItem(bot, "stone_pickaxe", 1);
      logger.info("Crafted stone pickaxe");
    }

    if (!hasItem(bot, "stone_sword") && !hasItem(bot, "iron_sword")) {
      try {
        await craftItem(bot, "stone_sword", 1);
        logger.info("Crafted stone sword");
      } catch {
        logger.debug("Couldn't craft stone sword");
      }
    }

    if (!hasItem(bot, "furnace")) {
      const cobbleCount = countItem(bot, "cobblestone");
      if (cobbleCount < 8) {
        const moreCobble = await findAndMineBlocks(bot, "stone", 8 - cobbleCount);
        logger.info(`Mined ${moreCobble} more cobblestone for furnace`);
      }
      await craftItem(bot, "furnace", 1);
      logger.info("Crafted furnace");
    }

    logger.info("Phase 2 complete: Stone tools and furnace ready");
  },
};
