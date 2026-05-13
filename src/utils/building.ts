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

  if (countItem(bot, "obsidian") < 10) {
    throw new Error(`Not enough obsidian: have ${countItem(bot, "obsidian")}, need 10`);
  }

  logger.info("Building nether portal frame");

  const off = (dx: number, dy: number, dz: number) => base.offset(dx, dy, dz);

  const steps: Array<{ pos: Vec3; item: "obsidian" | "cobblestone" }> = [
    { pos: off(0, 0, 0), item: "cobblestone" },
    { pos: off(3, 0, 0), item: "cobblestone" },
    { pos: off(1, 0, 0), item: "obsidian" },
    { pos: off(2, 0, 0), item: "obsidian" },
    { pos: off(0, 1, 0), item: "obsidian" },
    { pos: off(0, 2, 0), item: "obsidian" },
    { pos: off(0, 3, 0), item: "obsidian" },
    { pos: off(3, 1, 0), item: "obsidian" },
    { pos: off(3, 2, 0), item: "obsidian" },
    { pos: off(3, 3, 0), item: "obsidian" },
    { pos: off(0, 4, 0), item: "cobblestone" },
    { pos: off(3, 4, 0), item: "cobblestone" },
    { pos: off(1, 4, 0), item: "obsidian" },
    { pos: off(2, 4, 0), item: "obsidian" },
  ];

  for (const { pos, item } of steps) {
    await placeFrameBlock(bot, pos, item);
  }

  logger.info("Nether portal frame complete");
}

async function placeFrameBlock(bot: Bot, targetPos: Vec3, itemName: "obsidian" | "cobblestone"): Promise<void> {
  const existing = bot.blockAt(targetPos);
  if (existing && (existing.name === itemName || existing.name === "obsidian")) {
    logger.debug(`${existing.name} already at ${targetPos}`);
    return;
  }

  await goToPosition(bot, targetPos, 4);

  const item = bot.inventory.items().find((i) => i.name === itemName);
  if (!item) throw new Error(`Ran out of ${itemName} during portal construction`);

  const refBlock = findReferenceBlock(bot, targetPos);
  if (!refBlock) throw new Error(`Cannot place ${itemName} at ${targetPos}: no reference block`);

  await bot.equip(item, "hand");
  const face = targetPos.minus(refBlock.position);
  await bot.placeBlock(refBlock, new Vec3(face.x, face.y, face.z));
  logger.debug(`Placed ${itemName} at ${targetPos}`);
  await sleep(200);
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
