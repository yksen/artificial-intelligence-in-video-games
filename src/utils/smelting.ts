import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import { logger } from "../logger.js";
import { FUEL_ITEMS } from "../config.js";
import { findBlock, goToBlock, sleep } from "./navigation.js";
import { findAnyItem, freeInventory, countItem } from "./inventory.js";
import { mineBlock } from "./mining.js";
import { placeBlockFromInventory } from "./placement.js";
import { craftItem } from "./crafting.js";
import { escapeWater } from "./survival.js";

export async function ensureFurnace(bot: Bot): Promise<Block> {
  const existing = findBlock(bot, "furnace", 4);
  if (existing) {
    logger.debug("Found existing furnace nearby");
    return existing;
  }

  if (!bot.inventory.items().some((i) => i.name === "furnace")) {
    if (countItem(bot, "cobblestone") < 8) {
      throw new Error("No furnace and not enough cobblestone (need 8) to craft one");
    }
    logger.info("No furnace on hand — crafting a replacement from cobblestone");
    await craftItem(bot, "furnace", 1);
  }

  const placed = await placeBlockFromInventory(bot, "furnace");
  logger.info("Placed furnace");
  return placed;
}

export async function smeltItems(
  bot: Bot,
  inputName: string,
  count: number
): Promise<void> {
  const mcData = require("minecraft-data")(bot.version);
  const inputItem = mcData.itemsByName[inputName];
  if (!inputItem) throw new Error(`Unknown smelt input: ${inputName}`);

  await freeInventory(bot);

  const furnaceBlock = await ensureFurnace(bot);
  await goToBlock(bot, furnaceBlock);

  const furnace = await bot.openFurnace(furnaceBlock);
  try {
    const currentFuel = furnace.fuelItem();
    const hasFuel = currentFuel !== null || furnace.fuel > 0;
    if (!hasFuel) {
      const fuelItem = findAnyItem(bot, FUEL_ITEMS);
      if (!fuelItem) throw new Error("No fuel available for smelting");
      const fuelMcItem = mcData.itemsByName[fuelItem.name];
      if (!fuelMcItem) throw new Error(`Unknown fuel item: ${fuelItem.name}`);
      const fuelPerItem = ["coal", "charcoal"].includes(fuelItem.name) ? 8 : 1;
      const fuelNeeded = Math.ceil(count / fuelPerItem);
      logger.info(`Adding fuel: ${Math.min(fuelNeeded, fuelItem.count)}x ${fuelItem.name}`);
      await furnace.putFuel(fuelMcItem.id, null, Math.min(fuelNeeded, fuelItem.count));
    } else {
      logger.info("Furnace already has fuel, skipping fuel insertion");
    }
    logger.info(`Smelting ${count}x ${inputName}`);
    await furnace.putInput(inputItem.id, null, count);
  } finally {
    furnace.close();
  }

  try {
    await escapeWater(bot);
  } catch (err) {
    logger.debug(`Pre-smelt safety move failed: ${err}`);
  }

  const waitTime = count * 10000 + 2000;
  logger.info(`Waiting ~${Math.ceil(waitTime / 1000)}s for smelting...`);
  await sleep(waitTime);

  await freeInventory(bot);
  const collectBlock = findBlock(bot, "furnace", 16) ?? furnaceBlock;
  await goToBlock(bot, collectBlock);
  const collect = await bot.openFurnace(collectBlock);
  try {
    await collect.takeOutput();
    logger.info(`Smelting complete`);
  } finally {
    collect.close();
  }

}
