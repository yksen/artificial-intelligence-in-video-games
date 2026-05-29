import { defineScenario } from "../scenario.js";
import { countItem } from "../../src/utils/inventory.js";
import { eyesOfEnderPhase } from "../../src/phases/eyesOfEnder.js";

defineScenario({
  name: "eyes-of-ender",
  description: "Grind blaze rods to powder and craft 12+ eyes of ender",
  difficulty: "peaceful",
  timeoutMs: 60_000,

  async setup(ctx) {
    await ctx.clearInventory();
    await ctx.give("blaze_rod", 8);
    await ctx.give("ender_pearl", 15);
    await ctx.tp(0, 4, 0);
    await ctx.wait(600);
  },

  async run(ctx) {
    await eyesOfEnderPhase.execute(ctx.bot);
  },

  success(ctx) {
    return countItem(ctx.bot, "ender_eye") >= 12;
  },
});
