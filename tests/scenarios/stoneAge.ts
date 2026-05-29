import { defineScenario } from "../scenario.js";
import { hasItem, hasPickaxeTier } from "../../src/utils/inventory.js";
import { stoneAgePhase } from "../../src/phases/stoneAge.js";

defineScenario({
  name: "stone-age",
  description: "Mine a stone hill and craft stone tools + a furnace",
  difficulty: "peaceful",
  timeoutMs: 150_000,

  async setup(ctx) {
    await ctx.fill(3, 4, -1, 6, 6, 1, "stone");
    await ctx.clearInventory();
    await ctx.give("wooden_pickaxe", 1);
    await ctx.give("oak_planks", 16);
    await ctx.give("crafting_table", 1);
    await ctx.tp(0, 4, 0);
    await ctx.wait(600);
  },

  async run(ctx) {
    await stoneAgePhase.execute(ctx.bot);
  },

  success(ctx) {
    return hasPickaxeTier(ctx.bot, "stone") && hasItem(ctx.bot, "furnace");
  },
});
