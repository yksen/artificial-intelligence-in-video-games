import type { ScenarioCtx } from "./scenario.js";

export const SURFACE_Y = 3;
export const STAND_Y = 4;

export async function groundPatch(
  ctx: ScenarioCtx,
  x: number,
  z: number,
  w: number,
  d: number,
  block: string,
): Promise<void> {
  await ctx.fill(x, SURFACE_Y - 1, z, x + w - 1, SURFACE_Y, z + d - 1, block);
}

export async function oreField(
  ctx: ScenarioCtx,
  opts: { x: number; z: number; ore: string; count: number; base?: string; pad?: number },
): Promise<void> {
  const { x, z, ore, count } = opts;
  const base = opts.base ?? "stone";
  const pad = opts.pad ?? 1;
  const side = Math.max(1, Math.ceil(Math.sqrt(count)));

  await groundPatch(ctx, x - pad, z - pad, side + pad * 2, side + pad * 2, base);

  let placed = 0;
  for (let dz = 0; dz < side && placed < count; dz++) {
    for (let dx = 0; dx < side && placed < count; dx++) {
      await ctx.setblock(x + dx, SURFACE_Y, z + dz, ore);
      placed++;
    }
  }
}
