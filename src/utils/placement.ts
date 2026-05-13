import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import { Vec3 } from "vec3";
import { logger } from "../logger.js";
import { goToPosition, findBlock, sleep } from "./navigation.js";
import { findItem } from "./inventory.js";

const FACE_OFFSETS: ReadonlyArray<readonly [number, number, number]> = [
  [0, -1, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [0, 1, 0],
];

function solidReference(bot: Bot, pos: Vec3): Block | null {
  for (const [dx, dy, dz] of FACE_OFFSETS) {
    const ref = bot.blockAt(pos.offset(dx, dy, dz));
    if (ref && ref.name !== "air" && ref.name !== "water" && ref.name !== "lava" && ref.boundingBox === "block") {
      return ref;
    }
  }
  return null;
}

export async function placeBlockFromInventory(bot: Bot, itemName: string): Promise<Block> {
  if (!findItem(bot, itemName)) throw new Error(`No ${itemName} in inventory to place`);

  const p = bot.entity.position.floored();
  const base = new Vec3(p.x, p.y, p.z);
  const ring: Array<readonly [number, number]> = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
    [2, 0], [-2, 0], [0, 2], [0, -2],
  ];

  const targets: Vec3[] = [];
  for (const [dx, dz] of ring) {
    for (const dy of [0, 1, -1]) targets.push(base.offset(dx, dy, dz));
  }

  for (const target of targets) {
    const tb = bot.blockAt(target);
    if (!tb || tb.name !== "air") continue;
    const ref = solidReference(bot, target);
    if (!ref) continue;

    try {
      await goToPosition(bot, target, 3);
      const item = findItem(bot, itemName);
      if (!item) throw new Error(`No ${itemName} in inventory`);
      await bot.equip(item, "hand");

      const face = target.minus(ref.position);
      await bot.placeBlock(ref, new Vec3(face.x, face.y, face.z));
      await sleep(250);

      const placed = bot.blockAt(target);
      if (placed && placed.name === itemName) return placed;
      const near = findBlock(bot, itemName, 4);
      if (near) return near;
    } catch (err) {
      logger.debug(`Placement attempt for ${itemName} at ${target} failed: ${err}`);
    }
  }

  throw new Error(`Failed to place ${itemName} (no valid spot found nearby)`);
}
