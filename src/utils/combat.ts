import type { Bot } from "mineflayer";
import type { Entity } from "prismarine-entity";
import { logger } from "../logger.js";
import { SURVIVAL_THRESHOLDS, HOSTILE_MOBS } from "../config.js";
import { equipBestWeapon } from "./inventory.js";
import { goToPosition, sleep } from "./navigation.js";

export function getNearbyHostiles(bot: Bot, range: number = 16): Entity[] {
  return Object.values(bot.entities).filter((entity) => {
    if (!entity || entity === bot.entity) return false;
    if (entity.position.distanceTo(bot.entity.position) > range) return false;
    return HOSTILE_MOBS.includes(entity.name as any);
  });
}

export async function attackEntity(bot: Bot, entity: Entity): Promise<void> {
  await equipBestWeapon(bot);
  logger.info(`Attacking ${entity.name}`);
  (bot as any).pvp.attack(entity);

  return new Promise((resolve) => {
    const check = setInterval(() => {
      if (!entity.isValid) {
        (bot as any).pvp.stop();
        clearInterval(check);
        resolve();
      }
    }, 500);

    setTimeout(() => {
      (bot as any).pvp.stop();
      clearInterval(check);
      resolve();
    }, 30000);
  });
}

export function shouldFlee(bot: Bot): boolean {
  return bot.health <= SURVIVAL_THRESHOLDS.fleeAtHealth;
}

export async function flee(bot: Bot, entity: Entity, distance: number = 20): Promise<void> {
  logger.warn(`Fleeing from ${entity.name}! Health: ${bot.health}`);
  (bot as any).pvp.stop();

  const dir = bot.entity.position.minus(entity.position).normalize();
  const fleeTarget = bot.entity.position.plus(dir.scaled(distance));
  try {
    await goToPosition(bot, fleeTarget, 3);
  } catch {
    bot.setControlState("sprint", true);
    bot.setControlState("forward", true);
    await sleep(3000);
    bot.clearControlStates();
  }
}
