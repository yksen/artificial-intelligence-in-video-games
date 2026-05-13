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

const OFFHAND_SLOT = 45;

export async function raiseShield(bot: Bot): Promise<boolean> {
  const off = bot.inventory.slots[OFFHAND_SLOT];
  if (!off || off.name !== "shield") {
    const shield = bot.inventory.items().find((i) => i.name === "shield");
    if (!shield) return false;
    try {
      await bot.equip(shield, "off-hand");
    } catch {
      return false;
    }
  }
  try {
    bot.activateItem(true);
  } catch {
    return false;
  }
  return true;
}

export function lowerShield(bot: Bot): void {
  try {
    bot.deactivateItem();
  } catch {
  }
}

export function getNearestByNames(bot: Bot, names: readonly string[], range: number = 32): Entity | null {
  let best: Entity | null = null;
  let bestDist = Infinity;
  for (const e of Object.values(bot.entities)) {
    if (!e || e === bot.entity || !e.name) continue;
    if (!names.includes(e.name)) continue;
    if ((e as any).isValid === false) continue;
    const d = e.position.distanceTo(bot.entity.position);
    if (d <= range && d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}

export async function killEntity(
  bot: Bot,
  entity: Entity,
  opts: { timeoutMs?: number; minHealth?: number; reachApproach?: number; useShield?: boolean } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const minHealth = opts.minHealth ?? SURVIVAL_THRESHOLDS.fleeAtHealth;
  const approach = opts.reachApproach ?? 2;
  const useShield = opts.useShield ?? false;

  await equipBestWeapon(bot);
  const deadline = Date.now() + timeoutMs;

  let blocking = false;
  if (useShield) {
    await raiseShield(bot);
    lowerShield(bot);
  }
  const blockBelow = Math.max(minHealth + 5, 14);

  void approach;
  try {
    (bot as any).pvp.attack(entity);
  } catch {
  }

  while (entity.isValid && Date.now() < deadline) {
    if (bot.health <= minHealth) {
      logger.warn(`Breaking off attack on ${entity.name} (health ${bot.health})`);
      try {
        (bot as any).pvp?.stop?.();
      } catch {
      }
      if (blocking) lowerShield(bot);
      return false;
    }
    const held = (bot as any).heldItem;
    if (!held || !String(held.name).endsWith("_sword")) {
      await equipBestWeapon(bot);
    }
    if (useShield) {
      if (!blocking && bot.health < blockBelow) {
        blocking = await raiseShield(bot);
      } else if (blocking && bot.health >= blockBelow) {
        lowerShield(bot);
        blocking = false;
      }
    }
    await sleep(300);
  }

  try {
    (bot as any).pvp?.stop?.();
  } catch {
  }
  if (blocking) lowerShield(bot);
  return !entity.isValid;
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
