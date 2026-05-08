export const BOT_CONFIG = {
  host: process.env.BOT_HOST ?? "localhost",
  port: parseInt(process.env.BOT_PORT ?? "25565"),
  username: process.env.BOT_USERNAME ?? "Bot",
  version: "1.16.1",
} as const;

export const SURVIVAL_THRESHOLDS = {
  eatAtFood: 14,
  fleeAtHealth: 6,
  minFoodStock: 4,
} as const;

export const RESOURCE_TARGETS = {
  logs: 10,
  cobblestone: 16,
  cookedFood: 8,
  ironOre: 12,
  ironIngots: 10,
  diamonds: 3,
  obsidian: 10,
} as const;

export const MINING = {
  ironY: 32,
  diamondY: 11,
  branchSpacing: 3,
  branchLength: 25,
  maxSearchDistance: 64,
  oreSearchDistance: 32,
} as const;

export const NAVIGATION = {
  defaultRange: 2,
  interactRange: 4,
  maxDropDown: 4,
} as const;

export const LOG_BLOCKS = [
  "oak_log",
  "birch_log",
  "spruce_log",
  "jungle_log",
  "acacia_log",
  "dark_oak_log",
] as const;

export const PLANK_BLOCKS = [
  "oak_planks",
  "birch_planks",
  "spruce_planks",
  "jungle_planks",
  "acacia_planks",
  "dark_oak_planks",
] as const;

export const FOOD_ITEMS = [
  "cooked_beef",
  "cooked_porkchop",
  "cooked_mutton",
  "cooked_chicken",
  "cooked_cod",
  "cooked_salmon",
  "bread",
  "apple",
  "golden_apple",
  "baked_potato",
] as const;

export const RAW_FOOD_ITEMS = [
  "beef",
  "porkchop",
  "mutton",
  "chicken",
  "cod",
  "salmon",
  "potato",
] as const;

export const FOOD_ANIMALS = [
  "cow",
  "pig",
  "sheep",
  "chicken",
  "rabbit",
] as const;

export const HOSTILE_MOBS = [
  "zombie",
  "skeleton",
  "creeper",
  "spider",
  "enderman",
  "witch",
  "phantom",
] as const;

export const FUEL_ITEMS = [
  "coal",
  "charcoal",
  "oak_planks",
  "birch_planks",
  "spruce_planks",
  "jungle_planks",
  "acacia_planks",
  "dark_oak_planks",
  "oak_log",
  "birch_log",
  "spruce_log",
  "jungle_log",
  "acacia_log",
  "dark_oak_log",
] as const;
