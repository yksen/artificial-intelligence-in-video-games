import type { Bot } from "mineflayer";
import type { Phase } from "./types.js";
import { logger } from "../logger.js";
import { RESOURCE_TARGETS } from "../config.js";
import { countItem, hasItem, hasPickaxeTier } from "../utils/inventory.js";
import { findAndMineBlocks, findAndMineAnyBlock } from "../utils/mining.js";
import { craftItem, ensureItem } from "../utils/crafting.js";
import { smeltItems } from "../utils/smelting.js";
import { sleep } from "../utils/navigation.js";

export const ironAgePhase: Phase = {
  name: "Iron Age",

  canSkip(bot: Bot): boolean {
    const hasBucket = hasItem(bot, "bucket") || hasItem(bot, "water_bucket") || hasItem(bot, "lava_bucket");
    return hasPickaxeTier(bot, "iron") && hasBucket;
  },

  async execute(bot: Bot): Promise<void> {
    logger.info("=== Phase 4: Iron Age ===");

    const currentIron = countItem(bot, "iron_ingot");
    const currentOre = countItem(bot, "iron_ore");
    const totalIron = currentIron + currentOre;
    const neededOre = RESOURCE_TARGETS.ironIngots - totalIron;

    if (neededOre > 0) {
      logger.info(`Need to mine ${neededOre} iron ore`);
      const mined = await findAndMineBlocks(bot, "iron_ore", neededOre);
      logger.info(`Mined ${mined} iron ore`);

      if (mined === 0) {
        logger.info("No surface iron found, mining underground...");
        const { digDownTo } = await import("../utils/mining.js");
        await digDownTo(bot, 32);
        const deepMined = await findAndMineBlocks(bot, "iron_ore", neededOre, 32);
        logger.info(`Mined ${deepMined} iron ore underground`);
      }
    }

    const coalCount = countItem(bot, "coal");
    if (coalCount < 8) {
      logger.info("Collecting coal for fuel");
      await findAndMineBlocks(bot, "coal_ore", 8 - coalCount);
    }

    const oreCount = countItem(bot, "iron_ore");
    if (oreCount > 0) {
      logger.info(`Smelting ${oreCount} iron ore`);
      await smeltItems(bot, "iron_ore", oreCount);
    }

    await ensureItem(bot, "stick", 8);

    if (!hasPickaxeTier(bot, "iron")) {
      await craftItem(bot, "iron_pickaxe", 1);
      logger.info("Crafted iron pickaxe");
    }

    if (!hasItem(bot, "iron_sword") && !hasItem(bot, "diamond_sword")) {
      try {
        await craftItem(bot, "iron_sword", 1);
        logger.info("Crafted iron sword");
      } catch {
        logger.warn("Couldn't craft iron sword (not enough iron)");
      }
    }

    if (!hasItem(bot, "bucket") && !hasItem(bot, "water_bucket") && !hasItem(bot, "lava_bucket")) {
      await craftItem(bot, "bucket", 1);
      logger.info("Crafted bucket");
    }

    try {
      const { craftAndEquipArmor } = await import("../utils/inventory.js");
      await craftAndEquipArmor(bot, 1);
    } catch (err) {
      logger.debug(`Armor step skipped: ${err}`);
    }

    if (!hasItem(bot, "flint")) {
      logger.info("Mining gravel for flint");
      let emptyRounds = 0;
      let totalGravel = 0;
      while (!hasItem(bot, "flint") && emptyRounds < 4 && totalGravel < 64) {
        const mined = await findAndMineAnyBlock(bot, ["gravel"], 8, 40);
        totalGravel += mined;
        if (mined === 0) emptyRounds++;
        else emptyRounds = 0;
        await sleep(200);
      }
      if (!hasItem(bot, "flint")) {
        logger.warn(`Could not obtain flint from gravel (mined ${totalGravel} gravel)`);
      } else {
        logger.info("Obtained flint");
      }
    }

    if (!hasItem(bot, "flint_and_steel") && hasItem(bot, "flint")) {
      await craftItem(bot, "flint_and_steel", 1);
      logger.info("Crafted flint and steel");
    }

    logger.info(`Phase 4 complete: Iron tools, bucket, and flint & steel ready`);
  },
};
