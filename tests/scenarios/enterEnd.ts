import { defineScenario } from "../scenario.js";
import { phaseContext } from "../testBot.js";
import { enterEndPhase } from "../../src/phases/enterEnd.js";
import { groundPatch } from "../arena.js";

defineScenario({
  name: "enter-end",
  description: "Fill a 12-frame end portal with eyes and drop into the End",
  difficulty: "peaceful",
  timeoutMs: 120_000,

  async setup(ctx) {
    await groundPatch(ctx, -3, -5, 8, 10, "stone_bricks");

    const frame = (x: number, z: number, facing: string) =>
      ctx.setblock(x, 4, z, `end_portal_frame[facing=${facing},eye=false]`);
    for (let x = 0; x <= 2; x++) {
      await frame(x, -1, "south");
      await frame(x, 3, "north");
    }
    for (let z = 0; z <= 2; z++) {
      await frame(-1, z, "east");
      await frame(3, z, "west");
    }

    await ctx.clearInventory();
    await ctx.give("ender_eye", 15);
    await ctx.tp(1, 4, -3);
    await ctx.wait(800);
  },

  async run(ctx) {
    await enterEndPhase.execute(phaseContext(ctx.bot, "Enter The End"));
  },

  success(ctx) {
    return (ctx.bot.game as any).dimension === "the_end";
  },
});
