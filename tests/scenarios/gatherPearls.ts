import { defineScenario } from "../scenario.js";
import { countItem } from "../../src/utils/inventory.js";
import { buildNetherPortal, lightPortal, enterPortal } from "../../src/utils/building.js";
import { barterForPearls } from "../../src/phases/netherResources.js";

defineScenario({
  name: "gather-pearls",
  description: "Barter gold with piglins in the Nether for ender pearls (combat-free, flaky RNG)",
  difficulty: "easy",
  timeoutMs: 360_000,

  async setup(ctx) {
    await ctx.fill(-4, 1, -6, 12, 3, 6, "stone");
    await ctx.clearInventory();
    await ctx.give("obsidian", 10);
    await ctx.give("flint_and_steel", 1);
    await ctx.give("cobblestone", 64);
    await ctx.give("golden_boots", 1);
    await ctx.give("golden_helmet", 1);
    await ctx.give("golden_chestplate", 1);
    await ctx.give("golden_leggings", 1);
    await ctx.give("gold_ingot", 48);
    await ctx.give("cooked_beef", 16);
    await ctx.tp(0, 4, 0);
    await ctx.wait(800);
  },

  async run(ctx) {
    const basePos = ctx.bot.entity.position.floored().offset(2, 0, 0);
    await buildNetherPortal(ctx.bot, basePos);
    await lightPortal(ctx.bot, basePos);
    if (!(await enterPortal(ctx.bot, basePos))) throw new Error("failed to enter the Nether");
    await ctx.wait(1500);

    const p = ctx.bot.entity.position;
    const bx = Math.round(p.x);
    const by = Math.round(p.y);
    const bz = Math.round(p.z);
    const r = 7;
    const cmd = (c: string) => ctx.cmd(`execute in minecraft:the_nether run ${c}`);
    await cmd(`fill ${bx - r} ${by - 1} ${bz - r} ${bx + r} ${by - 1} ${bz + r} minecraft:netherrack`);
    await cmd(`fill ${bx - r} ${by} ${bz - r} ${bx + r} ${by + 3} ${bz + r} minecraft:air`);
    await cmd(`fill ${bx - r} ${by} ${bz - r} ${bx + r} ${by + 3} ${bz - r} minecraft:netherrack`);
    await cmd(`fill ${bx - r} ${by} ${bz + r} ${bx + r} ${by + 3} ${bz + r} minecraft:netherrack`);
    await cmd(`fill ${bx - r} ${by} ${bz - r} ${bx - r} ${by + 3} ${bz + r} minecraft:netherrack`);
    await cmd(`fill ${bx + r} ${by} ${bz - r} ${bx + r} ${by + 3} ${bz + r} minecraft:netherrack`);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const x = bx + Math.round(Math.cos(a) * 4);
      const z = bz + Math.round(Math.sin(a) * 4);
      await cmd(`summon minecraft:piglin ${x} ${by} ${z} {PersistenceRequired:1b,IsBaby:0b}`);
    }
    await ctx.wait(1000);

    await barterForPearls(ctx.bot, { target: 16 });
  },

  success(ctx) {
    return countItem(ctx.bot, "ender_pearl") >= 4;
  },
});
