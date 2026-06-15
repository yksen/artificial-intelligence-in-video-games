import { defineScenario } from "../scenario.js";
import { countItem } from "../../src/utils/inventory.js";
import { findAndMineBlocks } from "../../src/utils/mining.js";
import { oreField } from "../arena.js";

defineScenario({
  name: "mine-iron-ore",
  description: "Walk to and mine an iron ore vein exposed in a rocky patch",
  difficulty: "peaceful",
  timeoutMs: 90_000,

  async setup(ctx) {
    await oreField(ctx, { x: 5, z: 0, ore: "iron_ore", count: 1, pad: 1 });
    await ctx.clearInventory();
    await ctx.give("stone_pickaxe", 1);
    await ctx.tp(0, 4, 0);
    await ctx.wait(500);
  },

  async run(ctx) {
    const mined = await findAndMineBlocks(ctx.bot, "iron_ore", 1, 16);
    if (mined < 1) throw new Error("failed to mine the iron ore");
  },

  success(ctx) {
    return countItem(ctx.bot, "iron_ore") >= 1;
  },
});
