import { defineScenario } from "../scenario.js";
import { phaseContext } from "../testBot.js";
import { hasItem, hasPickaxeTier } from "../../src/utils/inventory.js";
import { stoneAgePhase } from "../../src/phases/stoneAge.js";

defineScenario({
  name: "stone-age",
  description: "Dig down to a buried stone deposit and craft stone tools + a furnace",
  difficulty: "peaceful",
  timeoutMs: 150_000,

  async setup(ctx) {
    await ctx.fill(2, 1, -2, 6, 2, 2, "stone");
    await ctx.clearInventory();
    await ctx.give("wooden_pickaxe", 1);
    await ctx.give("oak_planks", 16);
    await ctx.give("crafting_table", 1);
    await ctx.tp(0, 4, 0);
    await ctx.wait(600);
  },

  async run(ctx) {
    await stoneAgePhase.execute(phaseContext(ctx.bot, "Stone Age"));
  },

  success(ctx) {
    return hasPickaxeTier(ctx.bot, "stone") && hasItem(ctx.bot, "furnace");
  },
});
