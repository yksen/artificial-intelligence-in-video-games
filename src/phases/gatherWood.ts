import { definePhase } from "../step.js";
import { LOG_BLOCKS, PLANK_BLOCKS, RESOURCE_TARGETS } from "../config.js";
import { countItems, hasItem, hasPickaxeTier } from "../utils/inventory.js";
import { findAndMineAnyBlock } from "../utils/mining.js";
import { craftItem, ensureItem } from "../utils/crafting.js";

const ANY_SWORD = ["wooden_sword", "stone_sword", "iron_sword"];

export const gatherWoodPhase = definePhase({
  name: "Gather Wood",

  canSkip({ bot }) {
    const hasLogs = countItems(bot, [...LOG_BLOCKS]) >= 10;
    const hasPlanks = countItems(bot, [...PLANK_BLOCKS]) >= 8;
    return (hasLogs || hasPlanks) && hasPickaxeTier(bot, "wooden") && hasItem(bot, "crafting_table");
  },

  steps: () => [
    {
      name: "Gather logs",
      isDone: ({ bot }) => countItems(bot, [...LOG_BLOCKS]) >= RESOURCE_TARGETS.logs,
      run: async ({ bot, log }) => {
        const needed = RESOURCE_TARGETS.logs - countItems(bot, [...LOG_BLOCKS]);
        const mined = await findAndMineAnyBlock(bot, LOG_BLOCKS, needed);
        log.info(`Gathered ${mined} logs`);
      },
    },
    {
      name: "Craft planks",
      isDone: ({ bot }) => countItems(bot, [...PLANK_BLOCKS]) >= 8,
      run: async ({ bot, log }) => {
        const logItem = bot.inventory.items().find((i) => i.name.endsWith("_log"));
        if (!logItem) return;
        const planksName = logItem.name.replace("_log", "_planks");
        const planksCount = Math.min(logItem.count, 8);
        await craftItem(bot, planksName, planksCount);
        log.info(`Crafted ${planksCount * 4} planks`);
      },
    },
    {
      name: "Craft sticks",
      isDone: ({ bot }) => hasItem(bot, "stick"),
      run: ({ bot }) => ensureItem(bot, "stick", 8),
    },
    {
      name: "Craft crafting table",
      isDone: ({ bot }) => hasItem(bot, "crafting_table"),
      run: ({ bot }) => craftItem(bot, "crafting_table", 1),
    },
    {
      name: "Craft wooden pickaxe",
      isDone: ({ bot }) => hasPickaxeTier(bot, "wooden"),
      run: ({ bot }) => craftItem(bot, "wooden_pickaxe", 1),
    },
    {
      name: "Craft wooden sword",
      isDone: ({ bot }) => ANY_SWORD.some((s) => hasItem(bot, s)),
      run: async ({ bot, log }) => {
        try {
          await craftItem(bot, "wooden_sword", 1);
        } catch {
          log.debug("Couldn't craft wooden sword, will craft later");
        }
      },
    },
  ],
});
