import { defineScenario } from "../scenario.js";
import { phaseContext } from "../testBot.js";
import { hasItem, hasPickaxeTier } from "../../src/utils/inventory.js";
import { ironAgePhase } from "../../src/phases/ironAge.js";
import { oreField } from "../arena.js";

defineScenario({
  name: "iron-age",
  description: "Mine + smelt a little iron, craft iron gear and a bucket",
  difficulty: "peaceful",
  timeoutMs: 180_000,

  async setup(ctx) {
    await oreField(ctx, { x: 4, z: -1, ore: "iron_ore", count: 8, pad: 1 });

    await ctx.clearInventory();
    await ctx.give("stone_pickaxe", 1);
    await ctx.give("iron_ingot", 13);
    await ctx.give("oak_planks", 32);
    await ctx.give("crafting_table", 1);
    await ctx.give("furnace", 1);
    await ctx.give("coal", 8);
    await ctx.give("flint", 2);
    await ctx.tp(0, 4, 0);
    await ctx.wait(600);
  },

  async run(ctx) {
    await ironAgePhase.execute(phaseContext(ctx.bot, "Iron Age"));
  },

  success(ctx) {
    const hasBucket = hasItem(ctx.bot, "bucket") || hasItem(ctx.bot, "water_bucket");
    return hasPickaxeTier(ctx.bot, "iron") && hasBucket;
  },
});
