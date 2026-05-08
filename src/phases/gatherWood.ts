import type { Bot } from "mineflayer";
import type { Phase } from "./types.js";
import { logger } from "../logger.js";
import { LOG_BLOCKS, RESOURCE_TARGETS } from "../config.js";
import { countItems, hasItem, hasPickaxeTier } from "../utils/inventory.js";
import { findAndMineAnyBlock } from "../utils/mining.js";
import { craftItem, ensureItem } from "../utils/crafting.js";

export const gatherWoodPhase: Phase = {
  name: "Gather Wood",

  canSkip(bot: Bot): boolean {
    const hasLogs = countItems(bot, [...LOG_BLOCKS]) >= 10;
    const hasPlanks = countItems(bot, [
      "oak_planks", "birch_planks", "spruce_planks",
      "jungle_planks", "acacia_planks", "dark_oak_planks",
    ]) >= 8;
    const hasPickaxe = hasPickaxeTier(bot, "wooden");
    const hasTable = hasItem(bot, "crafting_table");
    return (hasLogs || hasPlanks) && hasPickaxe && hasTable;
  },

  async execute(bot: Bot): Promise<void> {
    logger.info("=== Phase 1: Gather Wood ===");

    const currentLogs = countItems(bot, [...LOG_BLOCKS]);
    const needed = RESOURCE_TARGETS.logs - currentLogs;

    if (needed > 0) {
      logger.info(`Need to gather ${needed} more logs`);
      const mined = await findAndMineAnyBlock(bot, LOG_BLOCKS, needed);
      logger.info(`Gathered ${mined} logs`);
    }

    const logItem = bot.inventory.items().find((i) => i.name.endsWith("_log"));
    if (logItem) {
      const planksName = logItem.name.replace("_log", "_planks");
      const planksCount = Math.min(logItem.count, 8);
      await craftItem(bot, planksName, planksCount);
      logger.info(`Crafted ${planksCount * 4} planks`);
    }

    await ensureItem(bot, "stick", 8);

    if (!hasItem(bot, "crafting_table")) {
      await craftItem(bot, "crafting_table", 1);
      logger.info("Crafted crafting table");
    }

    if (!hasPickaxeTier(bot, "wooden")) {
      await craftItem(bot, "wooden_pickaxe", 1);
      logger.info("Crafted wooden pickaxe");
    }

    if (!hasItem(bot, "wooden_sword") && !hasItem(bot, "stone_sword") && !hasItem(bot, "iron_sword")) {
      try {
        await craftItem(bot, "wooden_sword", 1);
        logger.info("Crafted wooden sword");
      } catch {
        logger.debug("Couldn't craft wooden sword, will craft later");
      }
    }

    logger.info("Phase 1 complete: Wood gathered and basic tools crafted");
  },
};
