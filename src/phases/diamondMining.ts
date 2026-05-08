import type { Bot } from "mineflayer";
import type { Phase } from "./types.js";
import { logger } from "../logger.js";
import { MINING, RESOURCE_TARGETS } from "../config.js";
import { countItem, hasItem, hasPickaxeTier } from "../utils/inventory.js";
import { findAndMineBlocks, digDownTo, branchMine } from "../utils/mining.js";
import { craftItem, ensureItem } from "../utils/crafting.js";
import { findBlock } from "../utils/navigation.js";

export const diamondMiningPhase: Phase = {
  name: "Diamond Mining",

  canSkip(bot: Bot): boolean {
    return hasItem(bot, "diamond_pickaxe") || countItem(bot, "diamond") >= RESOURCE_TARGETS.diamonds;
  },

  async execute(bot: Bot): Promise<void> {
    logger.info("=== Phase 5: Diamond Mining ===");

    if (!hasPickaxeTier(bot, "iron")) {
      throw new Error("No iron pickaxe or better available — cannot mine diamond ore");
    }

    if (!hasItem(bot, "water_bucket")) {
      const bucket = bot.inventory.items().find(
        (i) => i.name === "bucket" || i.name === "water_bucket"
      );
      if (bucket && bucket.name === "bucket") {
        const waterBlock = findBlock(bot, "water", 32);
        if (waterBlock) {
          const { goToBlock } = await import("../utils/navigation.js");
          await goToBlock(bot, waterBlock);
          await bot.equip(bucket, "hand");
          await bot.activateBlock(waterBlock);
          logger.info("Filled water bucket for lava safety");
        }
      }
    }

    const currentY = Math.floor(bot.entity.position.y);
    if (currentY > MINING.diamondY + 5) {
      logger.info(`Currently at Y=${currentY}, digging down to Y=${MINING.diamondY}`);
      await digDownTo(bot, MINING.diamondY);
    }

    let diamondCount = countItem(bot, "diamond");
    if (diamondCount < RESOURCE_TARGETS.diamonds) {
      const surfaceDiamonds = await findAndMineBlocks(
        bot,
        "diamond_ore",
        RESOURCE_TARGETS.diamonds - diamondCount,
        MINING.oreSearchDistance
      );
      diamondCount = countItem(bot, "diamond");
      if (surfaceDiamonds > 0) {
        logger.info(`Found ${surfaceDiamonds} exposed diamond ore!`);
      }
    }

    if (diamondCount < RESOURCE_TARGETS.diamonds) {
      logger.info("Starting branch mining for diamonds...");
      const found = await branchMine(
        bot,
        "diamond_ore",
        RESOURCE_TARGETS.diamonds - diamondCount
      );
      diamondCount = countItem(bot, "diamond");
      logger.info(`Branch mining found ${found} diamonds (total: ${diamondCount})`);
    }

    if (!hasItem(bot, "diamond_pickaxe") && diamondCount >= 3) {
      await ensureItem(bot, "stick", 2);
      await craftItem(bot, "diamond_pickaxe", 1);
      logger.info("Crafted diamond pickaxe!");
    }

    if (!hasItem(bot, "diamond_pickaxe")) {
      logger.warn(`Only found ${diamondCount} diamonds, need 3 for diamond pickaxe`);
      throw new Error("Failed to obtain enough diamonds for diamond pickaxe");
    }

    logger.info("Phase 5 complete: Diamond pickaxe crafted!");
  },
};
