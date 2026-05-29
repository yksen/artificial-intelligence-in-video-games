import { defineScenario } from "../scenario.js";
import { countItem } from "../../src/utils/inventory.js";
import { gatherGold } from "../../src/phases/netherResources.js";

defineScenario({
  name: "gather-gold",
  description: "Mine nether gold ore and craft the nuggets into ingots for bartering",
  difficulty: "peaceful",
  timeoutMs: 180_000,

  async setup(ctx) {
    await ctx.fill(3, 3, -3, 9, 3, 3, "nether_gold_ore");
    await ctx.clearInventory();
    await ctx.give("iron_pickaxe", 1);
    await ctx.give("crafting_table", 1);
    await ctx.tp(0, 4, 0);
    await ctx.wait(600);
  },

  async run(ctx) {
    await gatherGold(ctx.bot, 4);
  },

  success(ctx) {
    return countItem(ctx.bot, "gold_ingot") >= 4;
  },
});
