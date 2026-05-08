import type { Bot } from "mineflayer";
import { logger } from "../logger.js";
import { SURVIVAL_THRESHOLDS, FOOD_ITEMS } from "../config.js";
import { findAnyItem } from "./inventory.js";
import { sleep } from "./navigation.js";

export function shouldEat(bot: Bot): boolean {
  return bot.food <= SURVIVAL_THRESHOLDS.eatAtFood;
}

export async function eatFood(bot: Bot): Promise<boolean> {
  const food = findAnyItem(bot, FOOD_ITEMS);
  if (!food) {
    logger.warn("No food available to eat!");
    return false;
  }

  try {
    await bot.equip(food, "hand");
    logger.info(`Eating ${food.name} (food: ${bot.food}/20)`);
    await bot.consume();
    logger.info(`Ate ${food.name} (food now: ${bot.food}/20)`);
    return true;
  } catch (err) {
    logger.warn(`Failed to eat: ${err}`);
    return false;
  }
}

export async function eatUntilFull(bot: Bot): Promise<void> {
  while (bot.food < 20) {
    const ate = await eatFood(bot);
    if (!ate) break;
    await sleep(500);
  }
}

export function getFoodCount(bot: Bot): number {
  return bot.inventory.items().reduce((sum, item) => {
    return FOOD_ITEMS.includes(item.name as any) ? sum + item.count : sum;
  }, 0);
}
