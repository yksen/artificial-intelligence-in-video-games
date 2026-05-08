import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import { goals, Movements } from "mineflayer-pathfinder";
import { logger } from "../logger.js";
import { NAVIGATION, MINING } from "../config.js";

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export function configureMovements(bot: Bot): Movements {
  const movements = new Movements(bot);
  movements.canDig = true;
  movements.allow1by1towers = false;
  movements.allowParkour = true;
  movements.allowSprinting = true;
  movements.maxDropDown = NAVIGATION.maxDropDown;
  movements.dontMineUnderFallingBlock = true;
  return movements;
}

export async function goToBlock(bot: Bot, block: Block): Promise<void> {
  const goal = new goals.GoalGetToBlock(block.position.x, block.position.y, block.position.z);
  bot.pathfinder.setMovements(configureMovements(bot));
  await bot.pathfinder.goto(goal);
}

export async function goToPosition(bot: Bot, pos: Vec3Like, range: number = NAVIGATION.defaultRange): Promise<void> {
  const goal = new goals.GoalNear(pos.x, pos.y, pos.z, range);
  bot.pathfinder.setMovements(configureMovements(bot));
  await bot.pathfinder.goto(goal);
}

export async function goToY(bot: Bot, y: number): Promise<void> {
  const goal = new goals.GoalY(y);
  bot.pathfinder.setMovements(configureMovements(bot));
  await bot.pathfinder.goto(goal);
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
