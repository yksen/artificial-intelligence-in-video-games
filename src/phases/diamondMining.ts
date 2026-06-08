import type { Bot } from "mineflayer";
import { definePhase } from "../step.js";
import { MINING, RESOURCE_TARGETS } from "../config.js";
import { countItem, hasItem, hasPickaxeTier } from "../utils/inventory.js";
import { findAndMineBlocks, digDownTo, branchMine } from "../utils/mining.js";
import { craftItem, ensureItem } from "../utils/crafting.js";
import { fillWaterBucket } from "../utils/fluids.js";

const enoughDiamonds = (bot: Bot): boolean => countItem(bot, "diamond") >= RESOURCE_TARGETS.diamonds;

export const diamondMiningPhase = definePhase({
  name: "Diamond Mining",

  canSkip: ({ bot }) => hasItem(bot, "diamond_pickaxe") || enoughDiamonds(bot),

  steps: () => [
    {
      name: "Verify iron pickaxe",
      run: async ({ bot }) => {
        if (!hasPickaxeTier(bot, "iron")) {
          throw new Error("No iron pickaxe or better available — cannot mine diamond ore");
        }
      },
    },
    {
      name: "Fill water bucket for lava safety",
      isDone: ({ bot }) => hasItem(bot, "water_bucket") || !hasItem(bot, "bucket"),
      run: async ({ bot, log }) => {
        if (await fillWaterBucket(bot)) log.info("Filled water bucket for lava safety");
      },
    },
    {
      name: "Dig down to diamond level",
      isDone: ({ bot }) => Math.floor(bot.entity.position.y) <= MINING.diamondY + 5,
      run: ({ bot }) => digDownTo(bot, MINING.diamondY),
    },
    {
      name: "Mine exposed diamond ore",
      isDone: ({ bot }) => enoughDiamonds(bot),
      run: async ({ bot, log }) => {
        const found = await findAndMineBlocks(
          bot,
          "diamond_ore",
          RESOURCE_TARGETS.diamonds - countItem(bot, "diamond"),
          MINING.oreSearchDistance,
        );
        if (found > 0) log.info(`Found ${found} exposed diamond ore`);
      },
    },
    {
      name: "Branch mine for diamonds",
      isDone: ({ bot }) => enoughDiamonds(bot),
      run: async ({ bot, log }) => {
        const found = await branchMine(bot, "diamond_ore", RESOURCE_TARGETS.diamonds - countItem(bot, "diamond"));
        log.info(`Branch mining found ${found} diamonds (total: ${countItem(bot, "diamond")})`);
      },
    },
    {
      name: "Craft diamond pickaxe",
      isDone: ({ bot }) => hasItem(bot, "diamond_pickaxe"),
      run: async ({ bot }) => {
        if (countItem(bot, "diamond") < 3) {
          throw new Error(`Failed to obtain enough diamonds for diamond pickaxe (have ${countItem(bot, "diamond")})`);
        }
        await ensureItem(bot, "stick", 2);
        await craftItem(bot, "diamond_pickaxe", 1);
      },
    },
  ],
});
