import { defineScenario } from "../scenario.js";
import { countItem } from "../../src/utils/inventory.js";
import { findAndMineBlocks } from "../../src/utils/mining.js";

defineScenario({
  name: "mine-iron-ore",
  description: "Walk to and mine a placed iron ore block",
  difficulty: "peaceful",
  timeoutMs: 90_000,

  async setup(ctx) {
    await ctx.setblock(5, 3, 0, "iron_ore");
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
