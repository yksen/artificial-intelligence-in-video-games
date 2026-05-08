import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { logger } from "../logger.js";
import { goToPosition, sleep, type Vec3Like } from "./navigation.js";
import { countItem } from "./inventory.js";

function toVec3(v: Vec3Like): Vec3 {
  return new Vec3(v.x, v.y, v.z);
}

export async function buildNetherPortal(bot: Bot, basePos: Vec3Like): Promise<void> {
  const base = toVec3(basePos);
  const mcData = require("minecraft-data")(bot.version);
  const obsidianId = mcData.itemsByName["obsidian"]?.id;
  if (!obsidianId) throw new Error("Cannot find obsidian item ID");

  if (countItem(bot, "obsidian") < 10) {
    throw new Error(`Not enough obsidian: have ${countItem(bot, "obsidian")}, need 10`);
  }

  logger.info("Building nether portal frame");

  const portalOffsets = [
    [1, 0, 0], [2, 0, 0],
    [0, 1, 0], [0, 2, 0], [0, 3, 0],
    [3, 1, 0], [3, 2, 0], [3, 3, 0],
    [1, 4, 0], [2, 4, 0],
  ] as const;

  for (const [dx, dy, dz] of portalOffsets) {
    const targetPos = base.offset(dx, dy, dz);
    const block = bot.blockAt(targetPos);

    if (block && block.name === "obsidian") {
      logger.debug(`Obsidian already at ${targetPos}`);
      continue;
    }

    await goToPosition(bot, targetPos, 4);

    const obsidianItem = bot.inventory.items().find((i) => i.name === "obsidian");
    if (!obsidianItem) throw new Error("Ran out of obsidian during portal construction");
    await bot.equip(obsidianItem, "hand");

    const refBlock = findReferenceBlock(bot, targetPos);
    if (!refBlock) {
      logger.warn(`No reference block for placement at ${targetPos}, trying to scaffold`);
      await placeScaffold(bot, targetPos);
      const newRef = findReferenceBlock(bot, targetPos);
      if (!newRef) throw new Error(`Cannot place obsidian at ${targetPos}: no reference block`);
      await bot.equip(obsidianItem, "hand");
      const face = targetPos.minus(newRef.position);
      await bot.placeBlock(newRef, face);
    } else {
      const face = targetPos.minus(refBlock.position);
      await bot.placeBlock(refBlock, face);
    }

    logger.debug(`Placed obsidian at ${targetPos}`);
    await sleep(200);
  }

  logger.info("Nether portal frame complete");
}

function findReferenceBlock(bot: Bot, targetPos: Vec3Like) {
  const pos = toVec3(targetPos);
  const faceOffsets = [
    [0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
  ] as const;

  for (const [dx, dy, dz] of faceOffsets) {
    const refPos = pos.offset(dx, dy, dz);
    const block = bot.blockAt(refPos);
    if (block && block.name !== "air" && block.name !== "water" && block.name !== "lava") {
      return block;
    }
  }
  return null;
}

async function placeScaffold(bot: Bot, pos: Vec3Like): Promise<void> {
  const scaffoldItem = bot.inventory.items().find(
    (i) => i.name === "cobblestone" || i.name === "dirt" || i.name === "netherrack"
  );
  if (!scaffoldItem) return;

  const ref = findReferenceBlock(bot, pos);
  if (!ref) return;

  await bot.equip(scaffoldItem, "hand");
  const face = toVec3(pos).minus(ref.position);
  await bot.placeBlock(ref, face);
  await sleep(200);
}

export async function lightPortal(bot: Bot, basePos: Vec3Like): Promise<void> {
  logger.info("Lighting nether portal");
  const base = toVec3(basePos);

  const flintAndSteel = bot.inventory.items().find((i) => i.name === "flint_and_steel");
  if (!flintAndSteel) throw new Error("No flint and steel to light portal");

  const insidePos = base.offset(1, 1, 0);

  await goToPosition(bot, insidePos, 3);

  await bot.equip(flintAndSteel, "hand");

  const bottomBlock = bot.blockAt(base.offset(1, 0, 0));
  if (bottomBlock) {
    await bot.activateBlock(bottomBlock);
  }

  await sleep(1000);
  logger.info("Portal lit!");
}

export async function enterPortal(bot: Bot, basePos: Vec3Like): Promise<boolean> {
  logger.info("Entering nether portal...");

  const base = toVec3(basePos);
  const portalCenter = base.offset(1.5, 1, 0);
  await goToPosition(bot, portalCenter, 1);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      logger.warn("Portal entry timed out after 30 seconds");
      resolve(false);
    }, 30000);

    const check = setInterval(() => {
      if ((bot.game as any).dimension !== "overworld") {
        clearInterval(check);
        clearTimeout(timeout);
        logger.info(`Dimension changed to: ${bot.game.dimension}`);
        resolve(true);
      }
    }, 1000);
  });
}
