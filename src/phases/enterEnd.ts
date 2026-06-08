import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import type { Entity } from "prismarine-entity";
import { definePhase } from "../step.js";
import { logger } from "../logger.js";
import { countItem } from "../utils/inventory.js";
import { findBlockByNames, goToPosition, sleep, type Vec3Like } from "../utils/navigation.js";
import { mineBlock } from "../utils/mining.js";

const STRONGHOLD_BLOCKS = ["stone_bricks", "stone_brick_stairs", "cracked_stone_bricks", "mossy_stone_bricks"] as const;

export const enterEndPhase = definePhase({
  name: "Enter The End",

  canSkip: ({ bot }) => (bot.game as any).dimension === "the_end",

  steps: () => {
    let frames: Block[] = [];
    return [
      {
        name: "Verify enough eyes",
        run: async ({ bot }) => {
          if (countItem(bot, "ender_eye") < 12) {
            throw new Error(`Need 12 eyes of ender to open the portal; have ${countItem(bot, "ender_eye")}`);
          }
        },
      },
      {
        name: "Locate the stronghold",
        run: ({ bot }) => locateStronghold(bot),
      },
      {
        name: "Reach the portal room",
        run: async ({ bot }) => {
          frames = await reachPortalRoom(bot);
          if (frames.length < 12) {
            throw new Error(`Could not find the end portal frame room (found ${frames.length} frames)`);
          }
        },
      },
      {
        name: "Fill the portal frames",
        run: ({ bot }) => fillFrames(bot, frames),
      },
      {
        name: "Enter the portal",
        run: async ({ bot, log }) => {
          await enterPortal(bot, frames);
          if ((bot.game as any).dimension !== "the_end") throw new Error("Did not transition to the End");
          log.info("=== SUCCESS: Entered the End! ===");
        },
      },
    ];
  },
});

async function locateStronghold(bot: Bot): Promise<void> {
  logger.info("Throwing eyes of ender to locate the stronghold");
  const maxThrows = 40;

  for (let i = 0; i < maxThrows; i++) {
    if (findBlockByNames(bot, ["end_portal_frame"], 24)) return;

    const dir = await throwEyeAndReadDirection(bot);
    if (!dir) {
      logger.warn("Could not read a thrown eye; nudging forward");
      await travel(bot, { x: bot.entity.position.x + 30, y: bot.entity.position.y, z: bot.entity.position.z }, 6);
      continue;
    }

    const horiz = Math.hypot(dir.x, dir.z);
    if (horiz < 0.08) {
      logger.info("Eye barely moved horizontally — stronghold is below us");
      return;
    }

    const legLen = 64;
    const target: Vec3Like = {
      x: bot.entity.position.x + (dir.x / horiz) * legLen,
      y: bot.entity.position.y,
      z: bot.entity.position.z + (dir.z / horiz) * legLen,
    };
    await travel(bot, target, 8);

    if (findBlockByNames(bot, STRONGHOLD_BLOCKS, 12)) {
      logger.info("Reached stronghold brick");
      return;
    }
  }
  logger.warn("Exhausted eye throws while locating stronghold");
}

async function throwEyeAndReadDirection(bot: Bot): Promise<{ x: number; z: number } | null> {
  const eye = bot.inventory.items().find((it) => it.name === "ender_eye");
  if (!eye) return null;
  try {
    await bot.equip(eye, "hand");
    await bot.lookAt(bot.entity.position.offset(0, 1.5, 0), true);
    (bot as any).activateItem();
  } catch (err) {
    logger.debug(`Throw failed: ${err}`);
    return null;
  }

  await sleep(250);
  const eyeEntity = findEyeEntity(bot);
  if (!eyeEntity) {
    await sleep(1500);
    return null;
  }
  const p0 = eyeEntity.position.clone();
  await sleep(600);
  const p1 = eyeEntity.position.clone();
  await sleep(1200);
  return { x: p1.x - p0.x, z: p1.z - p0.z };
}

function findEyeEntity(bot: Bot): Entity | null {
  let best: Entity | null = null;
  let bestDist = Infinity;
  for (const e of Object.values(bot.entities)) {
    const name = (e as any)?.name ?? "";
    if (!/eye/i.test(name)) continue;
    const d = e.position.distanceTo(bot.entity.position);
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}

async function travel(bot: Bot, target: Vec3Like, range: number): Promise<void> {
  try {
    await goToPosition(bot, target, range);
    return;
  } catch {
  }
  const here = bot.entity.position;
  const dx = target.x - here.x;
  const dz = target.z - here.z;
  const d = Math.hypot(dx, dz) || 1;
  const hop: Vec3Like = { x: here.x + (dx / d) * 24, y: here.y, z: here.z + (dz / d) * 24 };
  try {
    await goToPosition(bot, hop, range);
  } catch {
  }
}

async function reachPortalRoom(bot: Bot): Promise<Block[]> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const frame = findBlockByNames(bot, ["end_portal_frame"], 32);
    if (frame) {
      try {
        await goToPosition(bot, frame.position, 4);
      } catch {
      }
      const frames = findBlocksByName(bot, "end_portal_frame", 12, 16);
      if (frames.length >= 12) return frames;
    }

    const below = bot.blockAt(bot.entity.position.offset(0, -1, 0));
    if (below && below.name !== "air" && below.name !== "lava" && below.name !== "water") {
      try {
        await mineBlock(bot, below);
        await sleep(400);
      } catch {
        try {
          await goToPosition(bot, { x: bot.entity.position.x + 3, y: bot.entity.position.y, z: bot.entity.position.z }, 1);
        } catch {
        }
      }
    } else {
      await sleep(400);
    }
  }
  return findBlocksByName(bot, "end_portal_frame", 12, 24);
}

async function fillFrames(bot: Bot, frames: Block[]): Promise<void> {
  logger.info(`Filling ${frames.length} end portal frames`);
  for (const frame of frames) {
    if (frameHasEye(frame)) continue;
    const eye = bot.inventory.items().find((it) => it.name === "ender_eye");
    if (!eye) {
      logger.warn("Ran out of eyes while filling frames");
      break;
    }
    try {
      await goToPosition(bot, frame.position, 3);
      await bot.equip(eye, "hand");
      await bot.lookAt(frame.position.offset(0.5, 0.5, 0.5), true);
      await bot.activateBlock(frame);
      await sleep(400);
    } catch (err) {
      logger.debug(`Failed to insert eye at ${frame.position}: ${err}`);
    }
  }
}

function frameHasEye(frame: Block): boolean {
  try {
    const props: any = (frame as any).getProperties?.();
    if (props && props.eye !== undefined) return props.eye === true || props.eye === "true";
  } catch {
  }
  return false;
}

async function enterPortal(bot: Bot, frames: Block[]): Promise<void> {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const f of frames) {
    cx += f.position.x;
    cy += f.position.y;
    cz += f.position.z;
  }
  const center: Vec3Like = { x: cx / frames.length, y: cy / frames.length, z: cz / frames.length };

  const deadline = Date.now() + 30_000;
  while ((bot.game as any).dimension !== "the_end" && Date.now() < deadline) {
    const portal = findBlockByNames(bot, ["end_portal"], 8);
    const target = portal ? { x: portal.position.x, y: portal.position.y, z: portal.position.z } : center;
    try {
      await goToPosition(bot, target, 0);
    } catch {
    }
    await sleep(1500);
  }
}

function findBlocksByName(bot: Bot, name: string, count: number, range: number): Block[] {
  const mcData = require("minecraft-data")(bot.version);
  const id = mcData.blocksByName[name]?.id;
  if (id === undefined) return [];
  return bot
    .findBlocks({ matching: id, maxDistance: range, count })
    .map((p) => bot.blockAt(p))
    .filter((b): b is Block => b !== null);
}
