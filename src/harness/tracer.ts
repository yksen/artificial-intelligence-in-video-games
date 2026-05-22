import type { HarnessEvent, OpStartData, OpEndData, PhaseData, Recorder } from "./events.js";

interface ActiveOp {
  id: number;
  op: string;
  args: Record<string, unknown>;
  startedAt: number;
}

export class Tracer {
  private activeOps = new Map<number, ActiveOp>();
  private _phase: string | null = null;
  private _phaseIndex: number | null = null;

  constructor(recorder: Recorder) {
    recorder.bus.on("op:start", (e: HarnessEvent<OpStartData>) => {
      this.activeOps.set(e.data.id, { ...e.data, startedAt: e.t });
    });
    recorder.bus.on("op:end", (e: HarnessEvent<OpEndData>) => {
      this.activeOps.delete(e.data.id);
    });
    recorder.bus.on("phase", (e: HarnessEvent<PhaseData>) => {
      if (e.data.action === "start") {
        this._phase = e.data.phase;
        this._phaseIndex = e.data.index ?? null;
      }
    });
  }

  get phase(): string | null {
    return this._phase;
  }
  get phaseIndex(): number | null {
    return this._phaseIndex;
  }

  currentOp(): ActiveOp | null {
    let latest: ActiveOp | null = null;
    for (const op of this.activeOps.values()) {
      if (!latest || op.startedAt > latest.startedAt) latest = op;
    }
    return latest;
  }

  currentActivity(): { text: string | null; elapsedMs: number | null } {
    const op = this.currentOp();
    if (!op) return { text: null, elapsedMs: null };
    return { text: formatOp(op.op, op.args), elapsedMs: Date.now() - op.startedAt };
  }
}

function formatOp(op: string, args: Record<string, unknown>): string {
  const parts: string[] = [op];
  if (typeof args.block === "string") parts.push(args.block);
  if (typeof args.item === "string") parts.push(args.item);
  if (typeof args.ref === "string") parts.push(`on ${args.ref}`);
  if (typeof args.goal === "string") parts.push(args.goal);
  if (args.pos) parts.push(`@ ${fmtPos(args.pos)}`);
  else if (args.refPos) parts.push(`@ ${fmtPos(args.refPos)}`);
  if (typeof args.dest === "string") parts.push(`-> ${args.dest}`);
  return parts.join(" ");
}

function fmtPos(p: any): string {
  if (p && typeof p.x === "number") return `(${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.z)})`;
  return "";
}
