import { defineScenario, type ScenarioCtx } from "../scenario.js";
import { countItem } from "../../src/utils/inventory.js";
import { buildNetherPortal, lightPortal, enterPortal } from "../../src/utils/building.js";
import { gatherBlazeRods } from "../../src/phases/netherResources.js";

defineScenario({
  name: "blaze-rods",
  description: "Enter the Nether and farm a fortress blaze spawner for rods (combat)",
  difficulty: "easy",
  timeoutMs: 240_000,

  async setup(ctx) {
    await ctx.fill(-4, 1, -6, 12, 3, 6, "stone");
    await ctx.clearInventory();
    await ctx.give("obsidian", 10);
    await ctx.give("flint_and_steel", 1);
    await ctx.give("cobblestone", 64);
    await ctx.give("iron_helmet", 1);
    await ctx.give("iron_chestplate", 1);
    await ctx.give("iron_leggings", 1);
    await ctx.give("iron_boots", 1);
    await ctx.give("iron_sword", 1);
    await ctx.give("shield", 1);
    await ctx.give("cooked_beef", 32);
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
    await buildFortressRoom(ctx, bx, by, bz);

    await gatherBlazeRods(ctx.bot, 2);
  },

  success(ctx) {
    return countItem(ctx.bot, "blaze_rod") * 2 + countItem(ctx.bot, "blaze_powder") >= 2;
  },
});

async function buildFortressRoom(ctx: ScenarioCtx, bx: number, by: number, bz: number): Promise<void> {
  const inNether = (cmd: string) => ctx.cmd(`execute in minecraft:the_nether run ${cmd}`);
  await inNether(`fill ${bx - 8} ${by - 1} ${bz - 8} ${bx + 8} ${by + 8} ${bz + 8} minecraft:nether_bricks`);
  await inNether(`fill ${bx - 7} ${by} ${bz - 7} ${bx + 7} ${by + 7} ${bz + 7} minecraft:air`);
  const spawner =
    "minecraft:spawner{SpawnData:{id:\"minecraft:blaze\"},Delay:40,MinSpawnDelay:200,MaxSpawnDelay:360,SpawnCount:1,MaxNearbyEntities:1,RequiredPlayerRange:16,SpawnRange:3}";
  await inNether(`setblock ${bx + 5} ${by} ${bz + 5} ${spawner}`);
  await ctx.wait(500);
}
