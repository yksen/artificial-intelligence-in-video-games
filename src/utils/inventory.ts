import type { Bot } from "mineflayer";
import type { Item } from "prismarine-item";
import { logger } from "../logger.js";
import { INVENTORY, JUNK_KEEP } from "../config.js";

const MAIN_SLOTS = 36;

function isTossable(name: string): boolean {
  return (
    name in JUNK_KEEP ||
    name.endsWith("_wool") ||
    name.endsWith("_sapling") ||
    name.endsWith("_flower") ||
    name.endsWith("_seeds")
  );
}

function keepCount(name: string): number {
  return JUNK_KEEP[name] ?? 0;
}

export async function freeInventory(
  bot: Bot,
  minFreeSlots: number = INVENTORY.minFreeSlots,
): Promise<void> {
  const freeNow = () => MAIN_SLOTS - bot.inventory.items().length;
  if (freeNow() >= minFreeSlots) return;

  const candidates = bot.inventory
    .items()
    .filter((i) => isTossable(i.name) && i.count > keepCount(i.name))
    .sort((a, b) => b.count - a.count);

  for (const item of candidates) {
    if (freeNow() >= INVENTORY.targetFreeSlots) break;
    const toss = item.count - keepCount(item.name);
    if (toss <= 0) continue;
    try {
      await bot.toss(item.type, null, toss);
      logger.info(`Freed inventory: tossed ${toss}x ${item.name}`);
    } catch (err) {
      logger.debug(`Could not toss ${item.name}: ${err}`);
    }
  }

  if (freeNow() < minFreeSlots) {
    logger.warn(`Inventory still tight after freeing (${freeNow()} free slots)`);
  }
}

export function countItem(bot: Bot, name: string): number {
  return bot.inventory.items().reduce((sum, item) => {
    return item.name === name ? sum + item.count : sum;
  }, 0);
}

export function countItems(bot: Bot, names: readonly string[]): number {
  return names.reduce((sum, name) => sum + countItem(bot, name), 0);
}

export function hasItem(bot: Bot, name: string, count: number = 1): boolean {
  return countItem(bot, name) >= count;
}

export function hasAnyItem(bot: Bot, names: readonly string[]): boolean {
  return names.some((name) => hasItem(bot, name));
}

export function findItem(bot: Bot, name: string): Item | null {
  return bot.inventory.items().find((item) => item.name === name) ?? null;
}

export function findAnyItem(bot: Bot, names: readonly string[]): Item | null {
  for (const name of names) {
    const item = findItem(bot, name);
    if (item) return item;
  }
  return null;
}

export function findBestWeapon(bot: Bot): Item | null {
  const weaponPriority = [
    "diamond_sword",
    "iron_sword",
    "stone_sword",
    "wooden_sword",
    "diamond_axe",
    "iron_axe",
    "stone_axe",
    "wooden_axe",
  ];
  return findAnyItem(bot, weaponPriority);
}

export async function equipBestWeapon(bot: Bot): Promise<boolean> {
  const weapon = findBestWeapon(bot);
  if (weapon) {
    await bot.equip(weapon, "hand");
    return true;
  }
  return false;
}

export async function equipBestArmor(bot: Bot): Promise<void> {
  const armorSlots = [
    { dest: "head" as const, items: ["diamond_helmet", "iron_helmet", "leather_helmet"] },
    { dest: "torso" as const, items: ["diamond_chestplate", "iron_chestplate", "leather_chestplate"] },
    { dest: "legs" as const, items: ["diamond_leggings", "iron_leggings", "leather_leggings"] },
    { dest: "feet" as const, items: ["diamond_boots", "iron_boots", "leather_boots"] },
  ];

  for (const slot of armorSlots) {
    const item = findAnyItem(bot, slot.items);
    if (item) {
      await bot.equip(item, slot.dest);
    }
  }
}

export async function craftAndEquipArmor(bot: Bot, ironReserve: number = 8): Promise<void> {
  const { craftItem } = await import("./crafting.js");

  const tryCraft = async (item: string) => {
    try {
      await craftItem(bot, item, 1);
      logger.info(`Crafted ${item}`);
      return true;
    } catch (err) {
      logger.debug(`Could not craft ${item}: ${err}`);
      return false;
    }
  };

  const spareIron = countItem(bot, "iron_ingot") - ironReserve;
  if (spareIron >= 8 && !hasAnyItem(bot, ["iron_chestplate", "diamond_chestplate"])) {
    await tryCraft("iron_chestplate");
  }

  const leatherNeed: Array<[string, string[], number]> = [
    ["leather_chestplate", ["iron_chestplate", "diamond_chestplate", "leather_chestplate"], 8],
    ["leather_leggings", ["iron_leggings", "diamond_leggings", "leather_leggings"], 7],
    ["leather_helmet", ["iron_helmet", "diamond_helmet", "leather_helmet"], 5],
    ["leather_boots", ["iron_boots", "diamond_boots", "leather_boots"], 4],
  ];
  for (const [item, covered, cost] of leatherNeed) {
    if (hasAnyItem(bot, covered)) continue;
    if (countItem(bot, "leather") < cost) continue;
    await tryCraft(item);
  }

  try {
    await equipBestArmor(bot);
  } catch {
  }
}

export function hasPickaxeTier(bot: Bot, tier: "wooden" | "stone" | "iron" | "diamond"): boolean {
  const tiers = ["wooden", "stone", "iron", "diamond"];
  const tierIndex = tiers.indexOf(tier);
  for (let i = tierIndex; i < tiers.length; i++) {
    if (hasItem(bot, `${tiers[i]}_pickaxe`)) return true;
  }
  return false;
}
