import { defineScenario } from "../scenario.js";
import { countItem } from "../../src/utils/inventory.js";
import { gatherGold } from "../../src/phases/netherResources.js";
import { oreField } from "../arena.js";

defineScenario({
  name: "gather-gold",
  description: "Mine a nether gold ore vein in a netherrack patch and craft nuggets into ingots",
  difficulty: "peaceful",
  timeoutMs: 180_000,

  async setup(ctx) {
    await oreField(ctx, { x: 3, z: -3, ore: "nether_gold_ore", count: 25, base: "netherrack", pad: 1 });
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
