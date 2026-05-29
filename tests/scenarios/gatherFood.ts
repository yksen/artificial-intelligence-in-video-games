import { defineScenario } from "../scenario.js";
import { getFoodCount } from "../../src/utils/survival.js";
import { gatherFoodPhase } from "../../src/phases/gatherFood.js";

defineScenario({
  name: "gather-food",
  description: "Hunt cows and cook the beef",
  difficulty: "peaceful",
  timeoutMs: 180_000,

  async setup(ctx) {
    await ctx.clearInventory();
    await ctx.give("stone_sword", 1);
    await ctx.give("furnace", 1);
    await ctx.give("coal", 8);
    await ctx.give("cooked_beef", 4);
    await ctx.tp(0, 4, 0);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const x = Math.round(Math.cos(a) * 5);
      const z = Math.round(Math.sin(a) * 5);
      await ctx.cmd(`summon minecraft:cow ${x} 4 ${z}`);
    }
    await ctx.wait(800);
  },

  async run(ctx) {
    await gatherFoodPhase.execute(ctx.bot);
  },

  success(ctx) {
    return getFoodCount(ctx.bot) >= 8;
  },
});
