import type { Bot } from "mineflayer";
import { logger } from "../logger.js";
import { SURVIVAL_THRESHOLDS, FOOD_ITEMS } from "../config.js";
import { findAnyItem } from "./inventory.js";
import { sleep, goToPosition, type Vec3Like } from "./navigation.js";

const PASSABLE = new Set(["air", "cave_air", "void_air"]);

export function isDrowning(bot: Bot): boolean {
  const inWater = !!(bot.entity as any)?.isInWater;
  const oxygen = (bot as any).oxygenLevel;
  return inWater && typeof oxygen === "number" && oxygen <= 10;
}

function findDryStand(bot: Bot, radius: number): Vec3Like | null {
  if (!bot.entity) return null;
  const base = bot.entity.position.floored();
  let best: Vec3Like | null = null;
  let bestDist = Infinity;

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dy = -2; dy <= 3; dy++) {
        const pos = base.offset(dx, dy, dz);
        const at = bot.blockAt(pos);
        const below = bot.blockAt(pos.offset(0, -1, 0));
        const above = bot.blockAt(pos.offset(0, 1, 0));
        if (!at || !below || !above) continue;
        const standable =
          PASSABLE.has(at.name) &&
          PASSABLE.has(above.name) &&
          below.boundingBox === "block" &&
          below.name !== "water" &&
          below.name !== "lava";
        if (!standable) continue;
        const d = Math.hypot(dx, dy, dz);
        if (d < bestDist) {
          bestDist = d;
          best = { x: pos.x + 0.5, y: pos.y, z: pos.z + 0.5 };
        }
      }
    }
  }
  return best;
}

export async function escapeWater(bot: Bot): Promise<boolean> {
  if (!(bot.entity as any)?.isInWater) return true;
  logger.warn(`Drowning risk (oxygen=${(bot as any).oxygenLevel ?? "?"}) — escaping water`);

  const dry = findDryStand(bot, 8);
  if (dry) {
    try {
      await goToPosition(bot, dry, 1);
    } catch (err) {
      logger.debug(`escapeWater goto failed: ${err}`);
    }
  }

  if ((bot.entity as any).isInWater) {
    bot.setControlState("jump", true);
    bot.setControlState("forward", true);
    await sleep(3000);
    bot.clearControlStates();
  }

  const safe = !(bot.entity as any).isInWater;
  if (safe) logger.info("Escaped water to dry ground");
  else logger.warn("Still in water after escape attempt");
  return safe;
}

const HOT = new Set(["lava", "fire", "soul_fire", "magma_block"]);

export function isInLavaOrFire(bot: Bot): boolean {
  if (!bot.entity) return false;
  if ((bot.entity as any).isInLava) return true;
  const p = bot.entity.position.floored();
  for (const off of [[0, 0, 0], [0, 1, 0]] as const) {
    const b = bot.blockAt(p.offset(off[0], off[1], off[2]));
    if (b && HOT.has(b.name)) return true;
  }
  return false;
}

export async function escapeLavaOrFire(bot: Bot): Promise<void> {
  logger.warn(`Lava/fire interrupt! health=${bot.health} — escaping`);
  const water = bot.inventory.items().find((i) => i.name === "water_bucket");
  if (water) {
    try {
      await bot.equip(water, "hand");
      await bot.look(bot.entity.yaw, -Math.PI / 2, true);
      await sleep(100);
      (bot as any).activateItem?.();
      await sleep(300);
      try { (bot as any).deactivateItem?.(); } catch { }
    } catch {
    }
  }

  const safe = findDryStand(bot, 10);
  if (safe) {
    try {
      await goToPosition(bot, safe, 0);
    } catch {
    }
  }
  if (isInLavaOrFire(bot)) {
    bot.setControlState("sprint", true);
    bot.setControlState("jump", true);
    bot.setControlState("forward", true);
    await sleep(1500);
    bot.clearControlStates();
  }
}

export function shouldEat(bot: Bot): boolean {
  return bot.food <= SURVIVAL_THRESHOLDS.eatAtFood;
}

let isConsuming = false;

export async function eatFood(bot: Bot): Promise<boolean> {
  if (isConsuming) return false;

  const food = findAnyItem(bot, FOOD_ITEMS);
  if (!food) {
    logger.warn("No food available to eat!");
    return false;
  }

  isConsuming = true;
  try {
    await bot.equip(food, "hand");
    logger.info(`Eating ${food.name} (food: ${bot.food}/20)`);
    await bot.consume();
    logger.info(`Ate ${food.name} (food now: ${bot.food}/20)`);
    return true;
  } catch (err) {
    logger.warn(`Failed to eat: ${err}`);
    return false;
  } finally {
    isConsuming = false;
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
