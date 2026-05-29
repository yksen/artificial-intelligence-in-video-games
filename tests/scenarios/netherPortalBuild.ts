import { defineScenario } from "../scenario.js";
import { buildNetherPortal, lightPortal, enterPortal } from "../../src/utils/building.js";

defineScenario({
  name: "nether-portal-build",
  description: "Build, light, and step through a nether portal into the Nether",
  difficulty: "peaceful",
  timeoutMs: 120_000,

  async setup(ctx) {
    await ctx.fill(-4, 1, -6, 12, 3, 6, "stone");

    await ctx.clearInventory();
    await ctx.give("obsidian", 10);
    await ctx.give("flint_and_steel", 1);
    await ctx.give("cobblestone", 64);
    await ctx.tp(0, 4, 0);
    await ctx.wait(800);
  },

  async run(ctx) {
    const basePos = ctx.bot.entity.position.floored().offset(2, 0, 0);
    await buildNetherPortal(ctx.bot, basePos);
    await lightPortal(ctx.bot, basePos);
    const entered = await enterPortal(ctx.bot, basePos);
    if (!entered) throw new Error("Built and lit the portal but failed to enter the Nether");
  },

  success(ctx) {
    return (ctx.bot.game as any).dimension === "the_nether";
  },
});
