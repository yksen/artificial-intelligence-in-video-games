import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import { logger } from "../logger.js";
import { MINING } from "../config.js";
import { findBlock, findBlocks, findBlockByNames, goToBlock, sleep, ensureNotHalted, type Vec3Like } from "./navigation.js";
import { hasPickaxeTier, freeInventory } from "./inventory.js";

const IRON_PICKAXE_REQUIRED = new Set([
  "diamond_ore",
  "gold_ore",
  "emerald_ore",
  "redstone_ore",
]);

export async function mineBlock(bot: Bot, block: Block): Promise<void> {
  ensureNotHalted(bot);
  if (IRON_PICKAXE_REQUIRED.has(block.name) && !hasPickaxeTier(bot, "iron")) {
    throw new Error(`Cannot mine ${block.name}: requires iron pickaxe or better`);
  }

  if (!bot.canDigBlock(block)) {
    await goToBlock(bot, block);
  }

  try {
    await (bot as any).tool.equipForBlock(block, { requireHarvest: true });
  } catch {
  }

  if (!bot.canDigBlock(block)) {
    throw new Error(`Cannot reach ${block.name} at ${block.position} to dig it`);
  }

  await digWithRetry(bot, block);
}

async function digWithRetry(bot: Bot, block: Block, attempts = 3): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await bot.dig(block);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/abort/i.test(msg) || i === attempts - 1) throw err;
      const cur = bot.blockAt(block.position);
      if (!cur || cur.name === "air") return;
      logger.debug(`Dig of ${block.name} aborted (${msg}); retry ${i + 1}/${attempts - 1}`);
      await sleep(300);
      if (!bot.canDigBlock(cur)) {
        try { await goToBlock(bot, cur); } catch { }
        if (!bot.canDigBlock(cur)) throw new Error(`Cannot reach ${cur.name} to retry dig`);
      }
    }
  }
}

async function collectBlocksByIds(
  bot: Bot,
  ids: number[],
  label: string,
  count: number,
  maxDistance: number
): Promise<number> {
  if (ids.length === 0) {
    logger.warn(`No known block ids for ${label}`);
    return 0;
  }

  let mined = 0;
  let stagnation = 0;

  while (mined < count && stagnation < 3) {
    ensureNotHalted(bot);
    await freeInventory(bot);

    const positions = bot.findBlocks({ matching: ids, maxDistance, count: count - mined });
    if (positions.length === 0) {
      logger.warn(`No more ${label} found within ${maxDistance} blocks`);
      break;
    }

    const blocks = positions
      .map((p) => bot.blockAt(p))
      .filter((b): b is Block => b !== null);

    const blocked = blocks.find((b) => IRON_PICKAXE_REQUIRED.has(b.name) && !hasPickaxeTier(bot, "iron"));
    if (blocked) throw new Error(`Cannot mine ${blocked.name}: requires iron pickaxe or better`);

    try {
      await (bot as any).collectBlock.collect(blocks, { ignoreNoPath: true });
    } catch (err) {
      logger.debug(`collectBlock(${label}): ${err}`);
    }

    let brokeThisRound = 0;
    for (const b of blocks) {
      const cur = bot.blockAt(b.position);
      if (!cur || cur.name === "air") brokeThisRound++;
    }

    if (brokeThisRound === 0) {
      stagnation++;
    } else {
      stagnation = 0;
      mined += brokeThisRound;
      logger.debug(`Mined ${label} (${mined}/${count})`);
    }
    await sleep(150);
  }

  if (stagnation >= 3) {
    logger.warn(`Could not reach any more ${label} (gave up after stagnating); mined ${mined}/${count}`);
  }
  return mined;
}

export async function findAndMineBlocks(
  bot: Bot,
  blockName: string,
  count: number,
  maxDistance: number = MINING.maxSearchDistance
): Promise<number> {
  const mcData = require("minecraft-data")(bot.version);
  const id = mcData.blocksByName[blockName]?.id;
  if (id === undefined) {
    logger.warn(`Unknown block type: ${blockName}`);
    return 0;
  }
  return collectBlocksByIds(bot, [id], blockName, count, maxDistance);
}

export async function findAndMineAnyBlock(
  bot: Bot,
  blockNames: readonly string[],
  count: number,
  maxDistance: number = MINING.maxSearchDistance
): Promise<number> {
  const mcData = require("minecraft-data")(bot.version);
  const ids = blockNames
    .map((n) => mcData.blocksByName[n]?.id)
    .filter((id: number | undefined): id is number => id !== undefined);
  return collectBlocksByIds(bot, ids, blockNames.join("/"), count, maxDistance);
}

export async function digDownTo(bot: Bot, targetY: number): Promise<void> {
  logger.info(`Digging staircase down to Y=${targetY}`);

  const mcData = require("minecraft-data")(bot.version);
  const { goals: g } = require("mineflayer-pathfinder");
  let direction = 0;
  const dirs = [
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 0, z: -1 },
  ];
  let stuckCount = 0;
  let lastY = Math.floor(bot.entity.position.y);

  while (Math.floor(bot.entity.position.y) > targetY + 1) {
    const currentY = Math.floor(bot.entity.position.y);

    if (currentY === lastY) {
      stuckCount++;
    } else {
      stuckCount = 0;
      lastY = currentY;
    }

    if (stuckCount >= 4) {
      logger.info("Staircase stuck, attempting to pathfind down through open space");
      try {
        await bot.pathfinder.goto(new g.GoalY(targetY + 1));
        break;
      } catch {
        logger.info("GoalY failed, digging straight down");
        await digStraightDown(bot, targetY);
        break;
      }
    }

    const pos = bot.entity.position.floored();
    const dir = dirs[direction % 4]!;

    const nextPos = pos.offset(dir.x, dir.y, dir.z);
    const stepDown = nextPos.offset(0, -1, 0);
    const stepBlock = bot.blockAt(nextPos);
    const stepDownBlock = bot.blockAt(stepDown);
    const headBlock = bot.blockAt(nextPos.offset(0, 1, 0));

    const belowFeet = bot.blockAt(pos.offset(0, -1, 0));
    const isOverCave = belowFeet && belowFeet.name === "air";

    if (isOverCave) {
      logger.info("Cave detected below, pathfinding through open space");
      try {
        await bot.pathfinder.goto(new g.GoalY(Math.max(targetY + 1, currentY - 10)));
        continue;
      } catch {
        await digStraightDown(bot, targetY);
        break;
      }
    }

    if (stepDownBlock && isLava(stepDownBlock)) {
      logger.warn("Lava detected ahead, changing direction");
      direction++;
      continue;
    }

    const allAir = (!stepBlock || stepBlock.name === "air") &&
                   (!stepDownBlock || stepDownBlock.name === "air") &&
                   (!headBlock || headBlock.name === "air");

    if (allAir) {
      try {
        await bot.pathfinder.goto(new g.GoalY(Math.max(targetY + 1, currentY - 5)));
        continue;
      } catch {
        direction++;
        continue;
      }
    }

    if (stepBlock && stepBlock.name !== "air" && !isLiquid(stepBlock)) {
      await mineBlock(bot, stepBlock);
    }

    if (headBlock && headBlock.name !== "air" && !isLiquid(headBlock)) {
      await mineBlock(bot, headBlock);
    }

    if (stepDownBlock && stepDownBlock.name !== "air" && !isLiquid(stepDownBlock)) {
      await mineBlock(bot, stepDownBlock);
    }

    try {
      await bot.pathfinder.goto(new g.GoalBlock(stepDown.x, stepDown.y, stepDown.z));
    } catch {
      direction++;
    }
  }

  logger.info(`Reached Y=${Math.floor(bot.entity.position.y)}`);
}

async function digStraightDown(bot: Bot, targetY: number): Promise<void> {
  logger.info("Digging straight down carefully");

  while (Math.floor(bot.entity.position.y) > targetY + 1) {
    const pos = bot.entity.position.floored();
    const below = bot.blockAt(pos.offset(0, -1, 0));

    if (!below) break;

    if (isLiquid(below)) {
      logger.warn(`Liquid below (${below.name}), stopping descent`);
      break;
    }

    const twoBelow = bot.blockAt(pos.offset(0, -2, 0));
    if (twoBelow && isLava(twoBelow)) {
      logger.warn("Lava detected two blocks below, stopping descent");
      break;
    }

    if (below.name !== "air") {
      await mineBlock(bot, below);
      await sleep(200);
    }

    await sleep(400);
  }
}

function isLava(block: Block): boolean {
  return block.name === "lava";
}

function isLiquid(block: Block): boolean {
  return block.name === "lava" || block.name === "water";
}

export async function branchMine(
  bot: Bot,
  targetOre: string,
  targetCount: number
): Promise<number> {
  const mcData = require("minecraft-data")(bot.version);
  const oreId = mcData.blocksByName[targetOre]?.id;
  let found = 0;

  logger.info(`Starting branch mining for ${targetOre} (need ${targetCount})`);

  const startPos = bot.entity.position.floored();
  const mainDir = { x: 1, y: 0, z: 0 };
  const branchDir = { x: 0, y: 0, z: 1 };

  for (let mainDist = 0; mainDist < MINING.branchLength * 4 && found < targetCount; mainDist++) {
    await mineForward(bot, mainDir, mcData);

    if (mainDist > 0 && mainDist % MINING.branchSpacing === 0) {
      const branchStart = bot.entity.position.floored();

      for (let i = 0; i < MINING.branchLength && found < targetCount; i++) {
        await mineForward(bot, branchDir, mcData);
        found += await collectVisibleOres(bot, targetOre, oreId, 4);
      }

      const { goals: g } = require("mineflayer-pathfinder");
      await bot.pathfinder.goto(new g.GoalBlock(branchStart.x, branchStart.y, branchStart.z));

      const negBranchDir = { x: -branchDir.x, y: -branchDir.y, z: -branchDir.z };
      for (let i = 0; i < MINING.branchLength && found < targetCount; i++) {
        await mineForward(bot, negBranchDir, mcData);
        found += await collectVisibleOres(bot, targetOre, oreId, 4);
      }

      await bot.pathfinder.goto(new g.GoalBlock(branchStart.x, branchStart.y, branchStart.z));
    }

    found += await collectVisibleOres(bot, targetOre, oreId, 4);
  }

  logger.info(`Branch mining complete: found ${found} ${targetOre}`);
  return found;
}

async function mineForward(bot: Bot, dir: Vec3Like, mcData: any): Promise<void> {
  const pos = bot.entity.position.floored();
  const forward = pos.offset(dir.x, dir.y, dir.z);
  const targets = [
    forward,
    forward.offset(0, 1, 0),
  ];

  for (const target of targets) {
    const block = bot.blockAt(target);
    if (block && block.name !== "air" && !isLiquid(block)) {
      const above = bot.blockAt(target.offset(0, 1, 0));
      if (above && (above.name === "gravel" || above.name === "sand")) {
        logger.debug("Falling block above, mining carefully");
      }
      await mineBlock(bot, block);
    }
  }

  try {
    const { goals: g } = require("mineflayer-pathfinder");
    await bot.pathfinder.goto(new g.GoalBlock(forward.x, forward.y, forward.z));
  } catch {
  }
}

async function collectVisibleOres(
  bot: Bot,
  oreName: string,
  oreId: number,
  range: number
): Promise<number> {
  const positions = bot.findBlocks({
    matching: oreId,
    maxDistance: range,
    count: 5,
  });

  let collected = 0;
  for (const pos of positions) {
    const block = bot.blockAt(pos);
    if (block) {
      try {
        await goToBlock(bot, block);
        await mineBlock(bot, block);
        collected++;
        await sleep(300);
        logger.info(`Found and mined ${oreName}!`);
      } catch (err) {
        logger.debug(`Couldn't mine visible ${oreName}: ${err}`);
      }
    }
  }
  return collected;
}
