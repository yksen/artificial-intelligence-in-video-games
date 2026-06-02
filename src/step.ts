import type { Phase } from "./types.js";
import type { PhaseContext } from "./runtime.js";
import { RunAbortedError } from "./runtime.js";

export interface Step {
  name: string;
  isDone?(ctx: PhaseContext): boolean | Promise<boolean>;
  run(ctx: PhaseContext): Promise<void>;
}

export async function runSteps(ctx: PhaseContext, steps: Step[]): Promise<void> {
  for (const step of steps) {
    if (ctx.signal.aborted) throw new RunAbortedError();
    if (step.isDone && (await step.isDone(ctx))) {
      ctx.log.debug(`skip "${step.name}" (already satisfied)`);
      continue;
    }
    ctx.log.info(step.name);
    await step.run(ctx);
  }
}

export function definePhase(def: {
  name: string;
  canSkip(ctx: PhaseContext): boolean;
  steps: (ctx: PhaseContext) => Step[];
}): Phase {
  return {
    name: def.name,
    canSkip: def.canSkip,
    async execute(ctx: PhaseContext): Promise<void> {
      await runSteps(ctx, def.steps(ctx));
    },
  };
}
