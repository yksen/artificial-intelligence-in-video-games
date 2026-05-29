import { defineScenario } from "../scenario.js";
import { countItem } from "../../src/utils/inventory.js";
import { createObsidian } from "../../src/phases/netherPortal.js";

defineScenario({
  name: "obsidian-cast",
  description: "Cast 2 obsidian from a contained lava pool",
  difficulty: "peaceful",
  timeoutMs: 180_000,

  async setup(ctx) {
    await ctx.fill(0, 1, -4, 14, 3, 4, "stone");
    await ctx.fill(9, 3, -1, 11, 3, 1, "lava");
    await ctx.fill(5, 3, -1, 6, 3, 1, "water");

    await ctx.clearInventory();
    await ctx.give("water_bucket", 1);
    await ctx.give("diamond_pickaxe", 1);
    await ctx.give("cobblestone", 32);
    await ctx.give("cooked_beef", 16);
    await ctx.tp(4, 4, 0);
    await ctx.wait(800);
  },

  async run(ctx) {
    await createObsidian(ctx.bot, 2);
  },

  success(ctx) {
    return countItem(ctx.bot, "obsidian") >= 2;
  },
});
