import type { Bot } from "mineflayer";
import type { Item } from "prismarine-item";

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

export function hasPickaxeTier(bot: Bot, tier: "wooden" | "stone" | "iron" | "diamond"): boolean {
  const tiers = ["wooden", "stone", "iron", "diamond"];
  const tierIndex = tiers.indexOf(tier);
  for (let i = tierIndex; i < tiers.length; i++) {
    if (hasItem(bot, `${tiers[i]}_pickaxe`)) return true;
  }
  return false;
}
