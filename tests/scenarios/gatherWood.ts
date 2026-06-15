import { defineScenario, type ScenarioCtx } from "../scenario.js";
import { phaseContext } from "../testBot.js";
import { hasItem, hasPickaxeTier } from "../../src/utils/inventory.js";
import { gatherWoodPhase } from "../../src/phases/gatherWood.js";

async function plantOak(ctx: ScenarioCtx, cx: number, cz: number): Promise<void> {
  await ctx.fill(cx - 2, 6, cz - 2, cx + 2, 7, cz + 2, "oak_leaves");
  await ctx.fill(cx - 1, 8, cz - 1, cx + 1, 8, cz + 1, "oak_leaves");
  await ctx.setblock(cx, 9, cz, "oak_leaves");
  await ctx.fill(cx, 4, cz, cx, 7, cz, "oak_log");
}

defineScenario({
  name: "gather-wood",
  description: "Chop a small grove of oak trees and craft the basic wooden toolkit",
  difficulty: "peaceful",
  timeoutMs: 150_000,

  async setup(ctx) {
    await plantOak(ctx, 4, 0);
    await plantOak(ctx, 8, -2);
    await ctx.clearInventory();
    await ctx.tp(0, 4, 0);
    await ctx.wait(600);
  },

  async run(ctx) {
    await gatherWoodPhase.execute(phaseContext(ctx.bot, "Gather Wood"));
  },

  success(ctx) {
    return hasPickaxeTier(ctx.bot, "wooden") && hasItem(ctx.bot, "crafting_table");
  },
});
