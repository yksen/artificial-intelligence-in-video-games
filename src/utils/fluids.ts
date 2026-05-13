import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import { Vec3 } from "vec3";
import { logger } from "../logger.js";
import { goToPosition, sleep } from "./navigation.js";
import { hasItem, findItem } from "./inventory.js";

const PASSABLE = new Set(["air", "cave_air", "void_air"]);

function isWaterSource(block: Block | null): block is Block {
  if (!block || block.name !== "water") return false;
  try {
    const props: any = (block as any).getProperties?.();
    if (props && props.level !== undefined) return props.level === 0 || props.level === "0";
  } catch {
  }
  return ((block as any).metadata ?? 0) === 0;
}

function hasExposedTop(bot: Bot, block: Block): boolean {
  const above = bot.blockAt(block.position.offset(0, 1, 0));
  return !!above && PASSABLE.has(above.name);
}

export async function fillWaterBucket(bot: Bot): Promise<boolean> {
  if (hasItem(bot, "water_bucket")) return true;
  if (!findItem(bot, "bucket")) {
    logger.warn("No empty bucket available to fill");
    return false;
  }

  const mcData = require("minecraft-data")(bot.version);
  const waterId = mcData.blocksByName["water"]?.id;
  if (waterId === undefined) return false;

  const me = bot.entity.position;
  const dist2 = (p: { x: number; y: number; z: number }) =>
    (p.x - me.x) ** 2 + (p.y - me.y) ** 2 + (p.z - me.z) ** 2;

  const candidates = bot
    .findBlocks({ matching: waterId, maxDistance: 128, count: 128 })
    .map((p) => bot.blockAt(p))
    .filter(isWaterSource)
    .sort((a, b) => {
      const ea = hasExposedTop(bot, a) ? 0 : 1;
      const eb = hasExposedTop(bot, b) ? 0 : 1;
      if (ea !== eb) return ea - eb;
      return dist2(a.position) - dist2(b.position);
    });

  if (candidates.length === 0) {
    logger.warn("No water source blocks found within range");
    return false;
  }
  logger.debug(`fillWaterBucket: ${candidates.length} source candidate(s)`);

  const tryList = candidates.filter((w) => Math.sqrt(dist2(w.position)) <= 64).slice(0, 8);
  for (const water of tryList) {
    if (Math.sqrt(dist2(water.position)) > 3.5) {
      try {
        await goToPosition(bot, water.position, 2);
      } catch {
      }
    }
    if (Math.sqrt(dist2(water.position)) > 4.5) continue;

    const bucket = findItem(bot, "bucket");
    if (!bucket) return hasItem(bot, "water_bucket");
    try {
      await bot.equip(bucket, "hand");
    } catch {
    }

    const center = new Vec3(water.position.x + 0.5, water.position.y + 0.5, water.position.z + 0.5);
    for (const strategy of ["item", "block"] as const) {
      try {
        await bot.lookAt(center, true);
        await sleep(150);
        if (strategy === "item") {
          (bot as any).activateItem?.();
        } else {
          await bot.activateBlock(water);
        }
        await sleep(450);
        if (strategy === "item") {
          try { (bot as any).deactivateItem?.(); } catch { }
        }
        if (hasItem(bot, "water_bucket")) {
          logger.info(`Filled water bucket from source at ${water.position} (${strategy})`);
          return true;
        }
      } catch (err) {
        logger.debug(`Fill attempt (${strategy}) at ${water.position} failed: ${err}`);
      }
    }
  }

  logger.warn("Could not fill water bucket from any accessible source");
  return hasItem(bot, "water_bucket");
}
