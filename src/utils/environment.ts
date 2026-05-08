import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import { logger } from "../logger.js";
import { findBlock, findBlocks, goToBlock, sleep } from "./navigation.js";

export function findExistingCraftingTable(bot: Bot, range: number = 32): Block | null {
  return findBlock(bot, "crafting_table", range);
}

export function findExistingFurnace(bot: Bot, range: number = 32): Block | null {
  return findBlock(bot, "furnace", range);
}

export function findNearbyChests(bot: Bot, range: number = 32): Block[] {
  return findBlocks(bot, "chest", range, 10);
}

export async function lootChest(bot: Bot, chestBlock: Block): Promise<void> {
  await goToBlock(bot, chestBlock);
  const chest = await bot.openContainer(chestBlock);

  const usefulItems = [
    "iron_ingot",
    "diamond",
    "gold_ingot",
    "bread",
    "apple",
    "coal",
    "obsidian",
    "ender_pearl",
    "blaze_rod",
    "iron_pickaxe",
    "diamond_pickaxe",
    "iron_sword",
    "diamond_sword",
    "flint_and_steel",
    "cooked_beef",
    "cooked_porkchop",
  ];

  try {
    for (const item of chest.containerItems()) {
      if (usefulItems.includes(item.name)) {
        await chest.withdraw(item.type, item.metadata, item.count);
        logger.info(`Looted ${item.count}x ${item.name} from chest`);
        await sleep(200);
      }
    }
  } finally {
    chest.close();
  }
}

export async function lootNearbyChests(bot: Bot, range: number = 32): Promise<void> {
  const chests = findNearbyChests(bot, range);
  if (chests.length === 0) return;

  logger.info(`Found ${chests.length} chest(s) nearby, looting...`);
  for (const chest of chests) {
    try {
      await lootChest(bot, chest);
    } catch (err) {
      logger.debug(`Failed to loot chest: ${err}`);
    }
  }
}
