import { defineScenario } from "../scenario.js";
import { phaseContext } from "../testBot.js";
import { hasItem } from "../../src/utils/inventory.js";
import { diamondMiningPhase } from "../../src/phases/diamondMining.js";
import { oreField } from "../arena.js";

defineScenario({
  name: "diamond-mine",
  description: "Mine a diamond ore vein exposed in a rocky patch and craft a diamond pickaxe",
  difficulty: "peaceful",
  timeoutMs: 120_000,

  async setup(ctx) {
    await oreField(ctx, { x: 4, z: 0, ore: "diamond_ore", count: 5, pad: 1 });
    await ctx.clearInventory();
    await ctx.give("iron_pickaxe", 1);
    await ctx.give("stick", 4);
    await ctx.give("crafting_table", 1);
    await ctx.tp(0, 4, 0);
    await ctx.wait(600);
  },

  async run(ctx) {
    await diamondMiningPhase.execute(phaseContext(ctx.bot, "Diamond Mining"));
  },

  success(ctx) {
    return hasItem(ctx.bot, "diamond_pickaxe");
  },
});
