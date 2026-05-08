import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import { Vec3 } from "vec3";
import { logger } from "../logger.js";
import { goToBlock, findBlock, sleep } from "./navigation.js";
import { mineBlock } from "./mining.js";

export async function ensureCraftingTable(bot: Bot): Promise<Block> {
  const existing = findBlock(bot, "crafting_table", 32);
  if (existing) {
    logger.debug("Found existing crafting table nearby");
    return existing;
  }

  const tableItem = bot.inventory.items().find((i) => i.name === "crafting_table");
  if (!tableItem) {
    logger.info("Crafting a crafting table from planks");
    const planksItem = bot.inventory.items().find((i) => i.name.endsWith("_planks"));
    if (!planksItem || planksItem.count < 4) {
      throw new Error("Not enough planks to craft a crafting table");
    }
    const mcData = require("minecraft-data")(bot.version);
    const craftingTableId = mcData.itemsByName["crafting_table"].id;
    const recipe = bot.recipesFor(craftingTableId, null, 1, null)[0];
    if (!recipe) throw new Error("No recipe found for crafting table");
    await bot.craft(recipe, 1);
    logger.info("Crafted crafting table");
  }

  const tableInv = bot.inventory.items().find((i) => i.name === "crafting_table");
  if (!tableInv) throw new Error("Failed to get crafting table in inventory");

  const placePos = bot.entity.position.offset(1, -1, 0).floored();
  const placeBlock = bot.blockAt(placePos);
  if (!placeBlock || placeBlock.name === "air") {
    const ground = bot.blockAt(bot.entity.position.offset(0, -1, 0).floored());
    if (ground && ground.name !== "air") {
      await bot.equip(tableInv, "hand");
      await bot.placeBlock(ground, new Vec3(1, 0, 0));
      logger.info("Placed crafting table");
      const placed = findBlock(bot, "crafting_table", 5);
      if (placed) return placed;
    }
  } else {
    await bot.equip(tableInv, "hand");
    await bot.placeBlock(placeBlock, new Vec3(0, 1, 0));
    logger.info("Placed crafting table");
    const placed = findBlock(bot, "crafting_table", 5);
    if (placed) return placed;
  }

  throw new Error("Failed to place crafting table");
}

export async function craftItem(
  bot: Bot,
  itemName: string,
  count: number = 1
): Promise<void> {
  const mcData = require("minecraft-data")(bot.version);
  const item = mcData.itemsByName[itemName];
  if (!item) throw new Error(`Unknown item: ${itemName}`);

  let recipes = bot.recipesFor(item.id, null, count, null);

  if (recipes.length > 0) {
    await bot.craft(recipes[0]!, count);
    logger.info(`Crafted ${count}x ${itemName} (inventory crafting)`);
    return;
  }

  const table = await ensureCraftingTable(bot);
  await goToBlock(bot, table);
  recipes = bot.recipesFor(item.id, null, count, table);

  if (recipes.length === 0) {
    throw new Error(`No recipe available for ${itemName} (missing ingredients?)`);
  }

  await bot.craft(recipes[0]!, count, table);
  logger.info(`Crafted ${count}x ${itemName}`);

  await pickupBlock(bot, "crafting_table");
}

export function canCraft(bot: Bot, itemName: string, count: number = 1): boolean {
  const mcData = require("minecraft-data")(bot.version);
  const item = mcData.itemsByName[itemName];
  if (!item) return false;

  const recipes = bot.recipesFor(item.id, null, count, null);
  if (recipes.length > 0) return true;

  const table = findBlock(bot, "crafting_table", 32);
  if (table) {
    const tableRecipes = bot.recipesFor(item.id, null, count, table);
    return tableRecipes.length > 0;
  }

  return false;
}

export async function ensureItem(
  bot: Bot,
  itemName: string,
  count: number
): Promise<void> {
  const current = bot.inventory.items().reduce(
    (sum, i) => (i.name === itemName ? sum + i.count : sum),
    0
  );
  if (current >= count) return;

  const needed = count - current;

  if (itemName.endsWith("_planks")) {
    const logName = itemName.replace("_planks", "_log");
    const logsNeeded = Math.ceil(needed / 4);
    const logItem = bot.inventory.items().find((i) => i.name === logName || i.name.endsWith("_log"));
    if (logItem) {
      const actualLogName = logItem.name;
      const actualPlanksName = actualLogName.replace("_log", "_planks");
      const craftCount = Math.min(logItem.count, logsNeeded);
      await craftItem(bot, actualPlanksName, craftCount);
      return;
    }
  }

  if (itemName === "stick") {
    const planksNeeded = Math.ceil(needed / 4) * 2;
    const planks = bot.inventory.items().find((i) => i.name.endsWith("_planks"));
    if (!planks || planks.count < planksNeeded) {
      const log = bot.inventory.items().find((i) => i.name.endsWith("_log"));
      if (log) {
        const planksName = log.name.replace("_log", "_planks");
        await craftItem(bot, planksName, Math.ceil(planksNeeded / 4));
      }
    }
    await craftItem(bot, "stick", Math.ceil(needed / 4));
    return;
  }

  await craftItem(bot, itemName, needed);
}

export async function pickupBlock(bot: Bot, blockName: string): Promise<void> {
  const block = findBlock(bot, blockName, 8);
  if (!block) return;

  try {
    await goToBlock(bot, block);
    await mineBlock(bot, block);
    await sleep(300);
    logger.debug(`Picked up ${blockName}`);
  } catch (err) {
    logger.debug(`Failed to pick up ${blockName}: ${err}`);
  }
}
