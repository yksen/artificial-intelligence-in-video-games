import { defineScenario } from "../scenario.js";
import { hasItem } from "../../src/utils/inventory.js";
import { diamondMiningPhase } from "../../src/phases/diamondMining.js";

defineScenario({
  name: "diamond-mine",
  description: "Mine surface diamond ore and craft a diamond pickaxe",
  difficulty: "peaceful",
  timeoutMs: 120_000,

  async setup(ctx) {
    for (let x = 4; x <= 8; x++) await ctx.setblock(x, 3, 0, "diamond_ore");
    await ctx.clearInventory();
    await ctx.give("iron_pickaxe", 1);
    await ctx.give("stick", 4);
    await ctx.give("crafting_table", 1);
    await ctx.tp(0, 4, 0);
    await ctx.wait(600);
  },

  async run(ctx) {
    await diamondMiningPhase.execute(ctx.bot);
  },

  success(ctx) {
    return hasItem(ctx.bot, "diamond_pickaxe");
  },
});
