import type { Bot } from "mineflayer";
import type { Phase } from "./types.js";
import { logger } from "../logger.js";
import { RESOURCE_TARGETS } from "../config.js";
import { countItem, hasItem } from "../utils/inventory.js";
import { findAndMineBlocks } from "../utils/mining.js";
import { findBlock, goToBlock, goToPosition, sleep } from "../utils/navigation.js";
import { buildNetherPortal, lightPortal, enterPortal } from "../utils/building.js";

export const netherPortalPhase: Phase = {
  name: "Nether Portal",

  canSkip(bot: Bot): boolean {
    return (bot.game as any).dimension === "the_nether";
  },

  async execute(bot: Bot): Promise<void> {
    logger.info("=== Phase 6: Nether Portal ===");

    let obsidianCount = countItem(bot, "obsidian");

    if (obsidianCount < RESOURCE_TARGETS.obsidian) {
      logger.info(`Need ${RESOURCE_TARGETS.obsidian - obsidianCount} more obsidian`);

      const existingObsidian = await findAndMineBlocks(
        bot,
        "obsidian",
        RESOURCE_TARGETS.obsidian - obsidianCount,
        48
      );
      obsidianCount = countItem(bot, "obsidian");

      if (obsidianCount < RESOURCE_TARGETS.obsidian) {
        logger.info("Creating obsidian from lava + water");
        await createObsidian(bot, RESOURCE_TARGETS.obsidian - obsidianCount);
        obsidianCount = countItem(bot, "obsidian");
      }
    }

    if (obsidianCount < RESOURCE_TARGETS.obsidian) {
      throw new Error(`Not enough obsidian: have ${obsidianCount}, need ${RESOURCE_TARGETS.obsidian}`);
    }

    logger.info("Finding a suitable location for portal");
    const currentY = Math.floor(bot.entity.position.y);
    if (currentY < 50) {
      const { goToY } = await import("../utils/navigation.js");
      await goToY(bot, 64);
    }

    const basePos = bot.entity.position.floored().offset(2, 0, 0);
    const groundBlock = bot.blockAt(basePos.offset(0, -1, 0));
    if (!groundBlock || groundBlock.name === "air") {
      const solidGround = bot.entity.position.floored();
      await buildNetherPortal(bot, solidGround.offset(2, 0, 0));
    } else {
      await buildNetherPortal(bot, basePos);
    }

    if (!hasItem(bot, "flint_and_steel")) {
      throw new Error("No flint and steel to light portal!");
    }
    await lightPortal(bot, basePos);

    await sleep(1000);
    const entered = await enterPortal(bot, basePos);

    if (entered) {
      logger.info("=== SUCCESS: Entered the Nether! ===");
    } else {
      logger.warn("Failed to enter the Nether portal, retrying...");
      const retryEnter = await enterPortal(bot, basePos);
      if (retryEnter) {
        logger.info("=== SUCCESS: Entered the Nether! ===");
      } else {
        throw new Error("Failed to enter the Nether");
      }
    }
  },
};

async function createObsidian(bot: Bot, count: number): Promise<void> {
  if (!hasItem(bot, "water_bucket")) {
    const bucket = bot.inventory.items().find((i) => i.name === "bucket");
    if (!bucket) throw new Error("No bucket available to create obsidian");

    const waterBlock = findBlock(bot, "water", 64);
    if (waterBlock) {
      await goToBlock(bot, waterBlock);
      await bot.equip(bucket, "hand");
      await bot.activateBlock(waterBlock);
      logger.info("Filled water bucket");
      await sleep(500);
    } else {
      throw new Error("No water source found to fill bucket");
    }
  }

  const lavaBlock = findBlock(bot, "lava", 64);
  if (!lavaBlock) {
    throw new Error("No lava source found to create obsidian");
  }

  logger.info(`Found lava at ${lavaBlock.position}`);
  await goToPosition(bot, lavaBlock.position, 4);

  let created = 0;
  while (created < count) {
    const lava = findBlock(bot, "lava", 16);
    if (!lava) {
      logger.warn("No more lava sources nearby");
      break;
    }

    const waterBucket = bot.inventory.items().find((i) => i.name === "water_bucket");
    if (!waterBucket) {
      logger.warn("Water bucket empty, trying to refill");
      const waterBlock = findBlock(bot, "water", 8);
      if (waterBlock) {
        const emptyBucket = bot.inventory.items().find((i) => i.name === "bucket");
        if (emptyBucket) {
          await bot.equip(emptyBucket, "hand");
          await bot.activateBlock(waterBlock);
          await sleep(500);
          continue;
        }
      }
      break;
    }

    await bot.equip(waterBucket, "hand");

    const adjacentSpots = [
      lava.position.offset(1, 0, 0),
      lava.position.offset(-1, 0, 0),
      lava.position.offset(0, 0, 1),
      lava.position.offset(0, 0, -1),
      lava.position.offset(0, 1, 0),
    ];

    let placed = false;
    for (const spot of adjacentSpots) {
      const block = bot.blockAt(spot);
      if (block && (block.name === "air" || block.name === "lava")) {
        const solidRef = findSolidAdjacent(bot, spot);
        if (solidRef) {
          try {
            const face = spot.minus(solidRef.position);
            await bot.placeBlock(solidRef, face);
            placed = true;
            await sleep(2000);
            break;
          } catch {
            continue;
          }
        }
      }
    }

    if (!placed) {
      try {
        await bot.activateBlock(lava);
        await sleep(2000);
      } catch {
        logger.warn("Failed to pour water on lava");
        break;
      }
    }

    await sleep(500);
    const waterToPickUp = findBlock(bot, "water", 8);
    if (waterToPickUp) {
      const emptyBucket = bot.inventory.items().find((i) => i.name === "bucket");
      if (emptyBucket) {
        await bot.equip(emptyBucket, "hand");
        await bot.activateBlock(waterToPickUp);
        await sleep(500);
      }
    }

    const obsidianBlock = findBlock(bot, "obsidian", 8);
    if (obsidianBlock) {
      const { mineBlock } = await import("../utils/mining.js");
      await goToBlock(bot, obsidianBlock);
      await mineBlock(bot, obsidianBlock);
      created++;
      logger.info(`Created and mined obsidian (${created}/${count})`);
      await sleep(300);
    }
  }
}

function findSolidAdjacent(bot: Bot, pos: { x: number; y: number; z: number }) {
  const faceOffsets = [
    [0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
  ] as const;

  for (const [dx, dy, dz] of faceOffsets) {
    const { Vec3 } = require("vec3");
    const checkPos = new Vec3(pos.x + dx, pos.y + dy, pos.z + dz);
    const block = bot.blockAt(checkPos);
    if (
      block &&
      block.name !== "air" &&
      block.name !== "water" &&
      block.name !== "lava" &&
      block.name !== "obsidian"
    ) {
      return block;
    }
  }
  return null;
}
