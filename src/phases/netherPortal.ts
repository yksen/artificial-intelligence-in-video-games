import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import { Vec3 } from "vec3";
import type { LogWriter } from "../logger.js";
import { logger } from "../logger.js";
import { definePhase } from "../step.js";
import { RESOURCE_TARGETS } from "../config.js";
import { countItem, hasItem, findItem } from "../utils/inventory.js";
import { findAndMineBlocks, mineBlock } from "../utils/mining.js";
import { findBlock, goToBlock, goToPosition, goToY, sleep } from "../utils/navigation.js";
import { buildNetherPortal, lightPortal, enterPortal } from "../utils/building.js";
import { fillWaterBucket } from "../utils/fluids.js";

export const netherPortalPhase = definePhase({
  name: "Nether Portal",

  canSkip: ({ bot }) => (bot.game as any).dimension === "the_nether",

  steps: () => [
    {
      name: "Acquire obsidian",
      isDone: ({ bot }) => countItem(bot, "obsidian") >= RESOURCE_TARGETS.obsidian,
      run: ({ bot, log }) => acquireObsidian(bot, log),
    },
    {
      name: "Build, light, and enter the portal",
      run: ({ bot, log }) => buildAndEnterPortal(bot, log),
    },
  ],
});

async function acquireObsidian(bot: Bot, log: LogWriter): Promise<void> {
  let obsidianCount = countItem(bot, "obsidian");
  const target = RESOURCE_TARGETS.obsidian;
  log.info(`Need ${target - obsidianCount} more obsidian`);

  if (findBlock(bot, "obsidian", 12)) {
    await findAndMineBlocks(bot, "obsidian", target - obsidianCount, 12);
    obsidianCount = countItem(bot, "obsidian");
  }

  if (obsidianCount < target) {
    log.info("Casting obsidian from lava + water");
    await createObsidian(bot, target - obsidianCount);
    obsidianCount = countItem(bot, "obsidian");
  }

  if (obsidianCount < target) {
    throw new Error(`Not enough obsidian: have ${obsidianCount}, need ${target}`);
  }
}

async function buildAndEnterPortal(bot: Bot, log: LogWriter): Promise<void> {
  if (Math.floor(bot.entity.position.y) < 50) {
    await goToY(bot, 64);
  }

  const basePos = bot.entity.position.floored().offset(2, 0, 0);
  await buildNetherPortal(bot, basePos);

  await ensureFlintAndSteel(bot);
  if (!hasItem(bot, "flint_and_steel")) {
    throw new Error("No flint and steel to light portal (could not obtain flint)!");
  }
  await lightPortal(bot, basePos);

  await sleep(1000);
  let entered = await enterPortal(bot, basePos);
  if (!entered) {
    log.warn("Failed to enter the Nether portal, retrying...");
    entered = await enterPortal(bot, basePos);
  }
  if (!entered) throw new Error("Failed to enter the Nether");
  log.info("=== SUCCESS: Entered the Nether! ===");
}

async function ensureFlintAndSteel(bot: Bot): Promise<void> {
  if (hasItem(bot, "flint_and_steel")) return;
  const { craftItem } = await import("../utils/crafting.js");

  if (!hasItem(bot, "flint")) {
    if (!hasItem(bot, "iron_ingot")) {
      logger.warn("Need iron for flint & steel but have none");
      return;
    }
    logger.info("No flint — mining gravel for it");
    let emptyRounds = 0;
    let total = 0;
    while (!hasItem(bot, "flint") && emptyRounds < 5 && total < 80) {
      const mined = await findAndMineBlocks(bot, "gravel", 8, 48);
      total += mined;
      if (mined === 0) emptyRounds++;
      else emptyRounds = 0;
      await sleep(150);
    }
  }

  if (hasItem(bot, "flint") && hasItem(bot, "iron_ingot")) {
    try {
      await craftItem(bot, "flint_and_steel", 1);
      logger.info("Crafted flint and steel");
    } catch (err) {
      logger.warn(`Failed to craft flint & steel: ${err}`);
    }
  }
}

const PASSABLE = new Set(["air", "cave_air", "void_air"]);

function isLavaSource(block: Block | null): block is Block {
  if (!block || block.name !== "lava") return false;
  try {
    const props: any = (block as any).getProperties?.();
    if (props && props.level !== undefined) return props.level === 0 || props.level === "0";
  } catch {
  }
  return ((block as any).metadata ?? 0) === 0;
}

function lavaNeighbourCount(bot: Bot, p: Vec3): number {
  let n = 0;
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]] as const) {
    const b = bot.blockAt(p.offset(dx, dy, dz));
    if (b && b.name === "lava") n++;
  }
  return n;
}

function findCastableLavaList(bot: Bot, maxDistance: number, count: number): Block[] {
  const mcData = require("minecraft-data")(bot.version);
  const lavaId = mcData.blocksByName["lava"]?.id;
  if (lavaId === undefined) return [];
  const me = bot.entity.position;
  const dist2 = (p: { x: number; y: number; z: number }) =>
    (p.x - me.x) ** 2 + (p.y - me.y) ** 2 + (p.z - me.z) ** 2;
  return bot
    .findBlocks({ matching: lavaId, maxDistance, count: 256 })
    .map((p) => bot.blockAt(p))
    .filter(isLavaSource)
    .filter((b) => {
      const above = bot.blockAt(b.position.offset(0, 1, 0));
      return !!above && PASSABLE.has(above.name);
    })
    .sort((a, b) => {
      const pa = Math.min(lavaNeighbourCount(bot, a.position), 3);
      const pb = Math.min(lavaNeighbourCount(bot, b.position), 3);
      if (pa !== pb) return pb - pa;
      return dist2(a.position) - dist2(b.position);
    })
    .slice(0, count);
}

function findCastableLava(bot: Bot, maxDistance: number): Block | null {
  const mcData = require("minecraft-data")(bot.version);
  const lavaId = mcData.blocksByName["lava"]?.id;
  if (lavaId === undefined) return null;

  const me = bot.entity.position;
  const dist2 = (p: { x: number; y: number; z: number }) =>
    (p.x - me.x) ** 2 + (p.y - me.y) ** 2 + (p.z - me.z) ** 2;

  const sources = bot
    .findBlocks({ matching: lavaId, maxDistance, count: 64 })
    .map((p) => bot.blockAt(p))
    .filter(isLavaSource)
    .filter((b) => {
      const above = bot.blockAt(b.position.offset(0, 1, 0));
      return !!above && PASSABLE.has(above.name);
    })
    .sort((a, b) => dist2(a.position) - dist2(b.position));

  return sources[0] ?? null;
}

async function approachLava(bot: Bot): Promise<boolean> {
  if (findCastableLava(bot, 32)) return true;

  for (const radius of [64, 128, 200]) {
    const lava = findCastableLava(bot, radius);
    if (lava) {
      const me = bot.entity.position;
      const lp = lava.position;
      const dist = Math.round(Math.sqrt((lp.x - me.x) ** 2 + (lp.y - me.y) ** 2 + (lp.z - me.z) ** 2));
      logger.info(`Lava source ${dist}m away — approaching`);
      try {
        await goToPosition(bot, lava.position, 4);
      } catch {
      }
      if (findCastableLava(bot, 32)) return true;
    }
  }

  const { digDownTo } = await import("../utils/mining.js");
  const currentY = Math.floor(bot.entity.position.y);
  if (currentY > 14) {
    logger.info("No lava nearby — digging a staircase down to the lava layer (Y~11)");
    try {
      await digDownTo(bot, 11);
    } catch (err) {
      logger.debug(`digDownTo failed: ${err}`);
    }
    for (const radius of [16, 48, 128]) {
      const lava = findCastableLava(bot, radius);
      if (lava) {
        try {
          await goToPosition(bot, lava.position, 4);
        } catch {
        }
        if (findCastableLava(bot, 32)) return true;
      }
    }
  }
  return findCastableLava(bot, 32) != null;
}

function findStandSpotNear(bot: Bot, lava: Block): Vec3 | null {
  const horiz: ReadonlyArray<readonly [number, number]> = [
    [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];
  for (const dy of [1, 0]) {
    for (const [dx, dz] of horiz) {
      const feet = lava.position.offset(dx, dy, dz);
      const at = bot.blockAt(feet);
      const head = bot.blockAt(feet.offset(0, 1, 0));
      const below = bot.blockAt(feet.offset(0, -1, 0));
      if (!at || !head || !below) continue;
      if (
        PASSABLE.has(at.name) &&
        PASSABLE.has(head.name) &&
        below.boundingBox === "block" &&
        below.name !== "lava" &&
        below.name !== "water"
      ) {
        return new Vec3(feet.x + 0.5, feet.y, feet.z + 0.5);
      }
    }
  }
  return null;
}

async function makeStandSpotNear(bot: Bot, lava: Block): Promise<Vec3 | null> {
  const place = bot.inventory.items().find((i) => i.name === "cobblestone" || i.name === "dirt" || i.name === "stone");
  if (!place) return null;
  const horiz: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dz] of horiz) {
    const footing = lava.position.offset(dx, -1, dz);
    const feet = lava.position.offset(dx, 0, dz);
    const head = lava.position.offset(dx, 1, dz);
    const footingBlock = bot.blockAt(footing);
    const feetBlock = bot.blockAt(feet);
    const headBlock = bot.blockAt(head);
    if (!footingBlock || !feetBlock || !headBlock) continue;
    if (!PASSABLE.has(feetBlock.name) || !PASSABLE.has(headBlock.name)) continue;
    if (footingBlock.name === "lava" || footingBlock.name === "water") continue;
    if (PASSABLE.has(footingBlock.name)) {
      const ref = findSolidNeighbour(bot, footing);
      if (!ref) continue;
      try {
        await goToPosition(bot, feet, 2);
        await bot.equip(place, "hand");
        const face = footing.minus(ref.position);
        await bot.placeBlock(ref, new Vec3(face.x, face.y, face.z));
        await sleep(250);
      } catch {
        continue;
      }
    }
    const nowFooting = bot.blockAt(footing);
    if (nowFooting && nowFooting.boundingBox === "block") {
      return new Vec3(feet.x + 0.5, feet.y, feet.z + 0.5);
    }
  }
  return null;
}

function findSolidNeighbour(bot: Bot, pos: Vec3) {
  const offs: ReadonlyArray<readonly [number, number, number]> = [
    [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
  ];
  for (const [dx, dy, dz] of offs) {
    const b = bot.blockAt(pos.offset(dx, dy, dz));
    if (b && b.boundingBox === "block" && b.name !== "lava" && b.name !== "water") return b;
  }
  return null;
}

async function emptyLavaBucket(bot: Bot): Promise<void> {
  const lavaBucket = findItem(bot, "lava_bucket");
  if (!lavaBucket) return;
  const me = bot.entity.position.floored();
  const spots: ReadonlyArray<readonly [number, number, number]> = [
    [2, 0, 0], [-2, 0, 0], [0, 0, 2], [0, 0, -2], [3, 0, 0], [0, 0, 3],
  ];
  for (const [dx, dy, dz] of spots) {
    const target = me.offset(dx, dy, dz);
    const block = bot.blockAt(target);
    const above = bot.blockAt(target.offset(0, 1, 0));
    if (!block || !above) continue;
    if (block.boundingBox !== "block" || block.name === "lava" || block.name === "water") continue;
    if (!PASSABLE.has(above.name)) continue;
    try {
      await bot.equip(lavaBucket, "hand");
      await bot.lookAt(new Vec3(target.x + 0.5, target.y + 1.0, target.z + 0.5), true);
      await sleep(120);
      (bot as any).activateItem?.();
      await sleep(400);
      try { (bot as any).deactivateItem?.(); } catch { }
      if (hasItem(bot, "bucket")) {
        logger.info("Emptied lava bucket — recovered empty bucket");
        return;
      }
    } catch {
    }
  }
  logger.warn("Could not empty lava bucket");
}

async function reclaimWater(bot: Bot): Promise<void> {
  if (hasItem(bot, "water_bucket")) return;
  if (!findItem(bot, "bucket")) return;
  await fillWaterBucket(bot);
}

async function harvestNearbyObsidian(bot: Bot, maxToMine: number): Promise<number> {
  if (maxToMine <= 0) return 0;
  const before = countItem(bot, "obsidian");
  for (let i = 0; i < maxToMine + 4; i++) {
    if (countItem(bot, "obsidian") - before >= maxToMine) break;
    const obs = findBlock(bot, "obsidian", 6);
    if (!obs) break;
    const pos = obs.position.clone();
    try {
      await mineBlock(bot, obs);
    } catch (err) {
      logger.debug(`Mining cast obsidian at ${pos} failed: ${err}`);
      break;
    }
    try { await goToPosition(bot, pos, 1); } catch { }
    await sleep(350);
    logger.info(`Mined obsidian at ${pos} (+${countItem(bot, "obsidian") - before} this cycle)`);
  }
  return countItem(bot, "obsidian") - before;
}

export async function createObsidian(bot: Bot, count: number): Promise<void> {
  if (!hasItem(bot, "water_bucket") && !hasItem(bot, "bucket") && hasItem(bot, "lava_bucket")) {
    await emptyLavaBucket(bot);
  }
  if (!hasItem(bot, "water_bucket") && !hasItem(bot, "bucket")) {
    const buckets = bot.inventory.items().filter((i) => i.name.includes("bucket")).map((i) => i.name);
    throw new Error(`No bucket available to create obsidian (have: ${buckets.join(",") || "none"})`);
  }

  let reservoir: { x: number; y: number; z: number } | null = null;

  const ensureWaterCharged = async (): Promise<boolean> => {
    if (hasItem(bot, "water_bucket")) return true;

    await reclaimWater(bot);
    if (hasItem(bot, "water_bucket")) {
      reservoir ??= bot.entity.position.clone();
      return true;
    }

    if (reservoir) {
      try { await goToPosition(bot, reservoir, 1); } catch { }
      await fillWaterBucket(bot);
      if (hasItem(bot, "water_bucket")) return true;
    }

    const { goToY } = await import("../utils/navigation.js");
    logger.info("No water reachable — surfacing to refill the bucket");
    try { await goToY(bot, 64); } catch { }
    await fillWaterBucket(bot);
    if (hasItem(bot, "water_bucket")) {
      reservoir = bot.entity.position.clone();
      return true;
    }
    return false;
  };

  if (!(await ensureWaterCharged())) {
    throw new Error("Could not fill water bucket (no accessible water source)");
  }

  const startObsidian = countItem(bot, "obsidian");
  const goal = startObsidian + count;
  let stagnation = 0;

  while (countItem(bot, "obsidian") < goal && stagnation < 6) {
    if (!(await ensureWaterCharged())) {
      throw new Error("Could not fill water bucket (no accessible water source)");
    }

    let candidates = findCastableLavaList(bot, 64, 24);
    if (candidates.length === 0) {
      const reached = await approachLava(bot);
      candidates = reached ? findCastableLavaList(bot, 64, 24) : [];
      if (candidates.length === 0) {
        logger.warn("No castable lava source reachable");
        stagnation++;
        continue;
      }
    }
    const have = countItem(bot, "obsidian") - startObsidian;
    logger.info(`${candidates.length} castable lava source(s); nearest at ${candidates[0]!.position} (have ${have}/${count})`);

    const before = countItem(bot, "obsidian");

    let poured = false;
    for (const lava of candidates) {
      if (!(await ensureWaterCharged())) break;
      const lavaPos = lava.position.clone();
      try {
        await goToPosition(bot, lavaPos, 2);
      } catch {
        continue;
      }
      const me = bot.entity.position;
      const d = Math.sqrt((lavaPos.x - me.x) ** 2 + (lavaPos.y - me.y) ** 2 + (lavaPos.z - me.z) ** 2);
      if (d > 4.6) continue;

      const waterBucket = findItem(bot, "water_bucket");
      if (!waterBucket) break;
      try {
        await bot.equip(waterBucket, "hand");
        await bot.lookAt(new Vec3(lavaPos.x + 0.5, lavaPos.y + 1.0, lavaPos.z + 0.5), true);
        await sleep(150);
        (bot as any).activateItem?.();
        await sleep(900);
        try { (bot as any).deactivateItem?.(); } catch { }
      } catch (err) {
        logger.debug(`Pour failed: ${err}`);
        continue;
      }
      const at = bot.blockAt(lavaPos);
      logger.info(`After pour, block at lava ${lavaPos} is "${at?.name}"`);
      poured = true;
      break;
    }

    if (!poured) {
      stagnation++;
      continue;
    }

    await reclaimWater(bot);
    await harvestNearbyObsidian(bot, goal - countItem(bot, "obsidian"));

    const gained = countItem(bot, "obsidian") - before;
    if (gained > 0) {
      stagnation = 0;
      logger.info(`Harvested ${gained} obsidian this cycle (have ${countItem(bot, "obsidian") - startObsidian}/${count})`);
    } else {
      stagnation++;
    }
    await sleep(150);
  }

  const total = countItem(bot, "obsidian");
  if (total < goal) {
    logger.warn(`Obsidian casting fell short: have ${total}, wanted ${goal}`);
  }
}
