import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import { Vec3 } from "vec3";
import { logger } from "../logger.js";
import { FUEL_ITEMS } from "../config.js";
import { findBlock, goToBlock, sleep } from "./navigation.js";
import { findAnyItem } from "./inventory.js";
import { mineBlock } from "./mining.js";

export async function ensureFurnace(bot: Bot): Promise<Block> {
  const existing = findBlock(bot, "furnace", 32);
  if (existing) {
    logger.debug("Found existing furnace nearby");
    return existing;
  }

  const furnaceItem = bot.inventory.items().find((i) => i.name === "furnace");
  if (!furnaceItem) {
    throw new Error("No furnace available (not in inventory and none nearby)");
  }

  const pos = bot.entity.position.floored();
  const placeCandidates = [
    pos.offset(2, -1, 0),
    pos.offset(-2, -1, 0),
    pos.offset(0, -1, 2),
    pos.offset(0, -1, -2),
    pos.offset(1, -1, 0),
    pos.offset(-1, -1, 0),
  ];

  for (const candidate of placeCandidates) {
    const block = bot.blockAt(candidate);
    if (block && block.name !== "air") {
      try {
        await bot.equip(furnaceItem, "hand");
        await bot.placeBlock(block, new Vec3(0, 1, 0));
        logger.info("Placed furnace");
        await sleep(200);
        const placed = findBlock(bot, "furnace", 5);
        if (placed) return placed;
      } catch {
        continue;
      }
    }
  }

  throw new Error("Failed to place furnace");
}

export async function smeltItems(
  bot: Bot,
  inputName: string,
  count: number
): Promise<void> {
  const furnaceBlock = await ensureFurnace(bot);
  await goToBlock(bot, furnaceBlock);

  const furnace = await bot.openFurnace(furnaceBlock);

  try {
    const mcData = require("minecraft-data")(bot.version);
    const inputItem = mcData.itemsByName[inputName];
    if (!inputItem) throw new Error(`Unknown smelt input: ${inputName}`);

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

    const waitTime = count * 10000 + 2000;
    logger.info(`Waiting ~${Math.ceil(waitTime / 1000)}s for smelting...`);
    await sleep(waitTime);

    await furnace.takeOutput();
    logger.info(`Smelting complete`);
  } finally {
    furnace.close();
  }

  await pickupFurnace(bot);
}

async function pickupFurnace(bot: Bot): Promise<void> {
  const block = findBlock(bot, "furnace", 8);
  if (!block) return;

  try {
    await goToBlock(bot, block);
    await mineBlock(bot, block);
    await sleep(300);
    logger.debug("Picked up furnace");
  } catch (err) {
    logger.debug(`Failed to pick up furnace: ${err}`);
  }
}
