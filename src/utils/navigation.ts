import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import { goals, Movements } from "mineflayer-pathfinder";
import { NAVIGATION, MINING } from "../config.js";
import { throwIfAborted, yieldToReflex } from "../runtime.js";

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export function configureMovements(bot: Bot): Movements {
  const movements = new Movements(bot);
  movements.canDig = true;
  movements.allow1by1towers = true;
  movements.allowParkour = true;
  movements.allowSprinting = true;
  movements.maxDropDown = NAVIGATION.maxDropDown;
  movements.dontMineUnderFallingBlock = true;
  return movements;
}

async function gotoWithTimeout(bot: Bot, goal: any, timeoutMs: number = NAVIGATION.gotoTimeoutMs): Promise<void> {
  await yieldToReflex(bot);
  bot.pathfinder.setMovements(configureMovements(bot));
  const gotoP = bot.pathfinder.goto(goal);
  gotoP.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      gotoP,
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`pathfinder goto exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (bot.pathfinder.isMoving()) {
      try { bot.pathfinder.setGoal(null); } catch { }
    }
  }
}

export async function goToBlock(bot: Bot, block: Block): Promise<void> {
  throwIfAborted(bot);
  const goal = new goals.GoalGetToBlock(block.position.x, block.position.y, block.position.z);
  await gotoWithTimeout(bot, goal);
}

export async function goToPosition(
  bot: Bot,
  pos: Vec3Like,
  range: number = NAVIGATION.defaultRange,
  timeoutMs: number = NAVIGATION.gotoTimeoutMs,
): Promise<void> {
  throwIfAborted(bot);
  const goal = new goals.GoalNear(pos.x, pos.y, pos.z, range);
  await gotoWithTimeout(bot, goal, timeoutMs);
}

export async function goToY(bot: Bot, y: number): Promise<void> {
  throwIfAborted(bot);
  const goal = new goals.GoalY(y);
  await gotoWithTimeout(bot, goal, NAVIGATION.gotoTimeoutMs * 2);
}

export function findBlock(bot: Bot, name: string, maxDistance: number = MINING.maxSearchDistance): Block | null {
  const mcData = require("minecraft-data")(bot.version);
  const blockType = mcData.blocksByName[name];
  if (!blockType) return null;

  return bot.findBlock({
    matching: blockType.id,
    maxDistance,
  });
}

export function findBlocks(
  bot: Bot,
  name: string,
  maxDistance: number = MINING.maxSearchDistance,
  count: number = 10
): Block[] {
  const mcData = require("minecraft-data")(bot.version);
  const blockType = mcData.blocksByName[name];
  if (!blockType) return [];

  const positions = bot.findBlocks({
    matching: blockType.id,
    maxDistance,
    count,
  });

  return positions
    .map((pos) => bot.blockAt(pos))
    .filter((b): b is Block => b !== null);
}

export function findBlockByNames(
  bot: Bot,
  names: readonly string[],
  maxDistance: number = MINING.maxSearchDistance
): Block | null {
  const mcData = require("minecraft-data")(bot.version);
  const ids = names
    .map((name) => mcData.blocksByName[name]?.id)
    .filter((id): id is number => id !== undefined);

  if (ids.length === 0) return null;

  return bot.findBlock({
    matching: ids,
    maxDistance,
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
