import type { PhaseContext } from "./runtime.js";

export interface Phase {
  name: string;
  canSkip(ctx: PhaseContext): boolean;
  execute(ctx: PhaseContext): Promise<void>;
}
