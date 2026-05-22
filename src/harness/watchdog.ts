import { HARNESS } from "./config.js";
import type { HarnessEvent, Recorder } from "./events.js";
import type { Telemetry } from "./telemetry.js";
import type { Tracer } from "./tracer.js";

export interface StuckDiagnosis {
  source: "no-progress";
  noProgressMs: number;
  phase: string | null;
  activity: string | null;
  activityElapsedMs: number | null;
  pos: { x: number; y: number; z: number } | null;
  health: number | null;
  food: number | null;
  dimension: string | null;
  currentOp: { op: string; args: Record<string, unknown>; elapsedMs: number } | null;
  targetDist: number | null;
  lastError: string | null;
  lastBlockEventAgeMs: number | null;
  pathGoal: string | null;
  nearbyHostiles: number;
  hint: string;
}

export class Watchdog {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastProgressAt = Date.now();
  private stallReported = false;
  private graceUntil = 0;

  private lastPos: { x: number; y: number; z: number } | null = null;
  private lastInvSig = "";
  private lastError: string | null = null;
  private lastBlockEventAt = 0;

  onStuck: ((diag: StuckDiagnosis) => void) | null = null;

  constructor(
    private recorder: Recorder,
    private telemetry: Telemetry,
    private tracer: Tracer,
  ) {
    recorder.onEvent((e) => this.observe(e));
  }

  grantGrace(ms: number): void {
    this.graceUntil = Math.max(this.graceUntil, Date.now() + ms);
    this.markProgress();
  }

  start(): void {
    if (!HARNESS.watchdog.enabled || this.timer) return;
    this.timer = setInterval(() => this.check(), HARNESS.watchdog.checkIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private markProgress(): void {
    this.lastProgressAt = Date.now();
    if (this.stallReported) this.stallReported = false;
  }

  private observe(e: HarnessEvent): void {
    switch (e.type) {
      case "op:end": {
        const d: any = e.data;
        if (d.outcome === "ok") this.markProgress();
        if (d.outcome === "error" || d.outcome === "timeout") this.lastError = d.error ?? this.lastError;
        break;
      }
      case "phase":
        this.markProgress();
        break;
      case "log":
        if ((e.data as any).level === "ERROR") this.lastError = (e.data as any).message;
        break;
      case "mc": {
        const ev = (e.data as any).event;
        if (ev === "digComplete") {
          this.lastBlockEventAt = e.t;
          this.markProgress();
        } else if (ev === "spawn" || ev === "death" || ev === "goal_reached" || ev === "forcedMove") {
          this.markProgress();
        }
        break;
      }
      case "state": {
        const s: any = e.data;
        if (s.pos) {
          if (
            !this.lastPos ||
            Math.abs(s.pos.x - this.lastPos.x) > HARNESS.watchdog.posEpsilon ||
            Math.abs(s.pos.y - this.lastPos.y) > HARNESS.watchdog.posEpsilon ||
            Math.abs(s.pos.z - this.lastPos.z) > HARNESS.watchdog.posEpsilon
          ) {
            this.lastPos = s.pos;
            this.markProgress();
          }
        }
        const sig = (s.inventory ?? []).map((i: any) => `${i.name}:${i.count}`).join(",");
        if (sig !== this.lastInvSig) {
          this.lastInvSig = sig;
          this.markProgress();
        }
        break;
      }
    }
  }

  private check(): void {
    const now = Date.now();
    if (now < this.graceUntil) return;

    const phase = this.tracer.phase;
    const snap = this.telemetry.last;
    if (!phase || !snap || snap.health === null) return;

    const noProgressMs = now - this.lastProgressAt;
    if (noProgressMs < HARNESS.watchdog.noProgressMs) return;
    if (this.stallReported) return;

    this.stallReported = true;
    const diag = this.buildDiagnosis(noProgressMs);
    this.recorder.record("stuck", diag);
    this.onStuck?.(diag);
  }

  private buildDiagnosis(noProgressMs: number): StuckDiagnosis {
    const snap = this.telemetry.last!;
    const op = this.tracer.currentOp();
    const currentOp = op
      ? { op: op.op, args: op.args, elapsedMs: Date.now() - op.startedAt }
      : null;

    let targetDist: number | null = null;
    const targetPos = (op?.args as any)?.pos ?? (op?.args as any)?.refPos;
    if (targetPos && snap.pos) {
      targetDist = round1(
        Math.hypot(targetPos.x - snap.pos.x, targetPos.y - snap.pos.y, targetPos.z - snap.pos.z),
      );
    }

    const lastBlockEventAgeMs = this.lastBlockEventAt ? Date.now() - this.lastBlockEventAt : null;

    return {
      source: "no-progress",
      noProgressMs,
      phase: snap.phase,
      activity: snap.activity,
      activityElapsedMs: snap.activityElapsedMs,
      pos: snap.pos,
      health: snap.health,
      food: snap.food,
      dimension: snap.dimension,
      currentOp,
      targetDist,
      lastError: this.lastError,
      lastBlockEventAgeMs,
      pathGoal: snap.pathGoal,
      nearbyHostiles: snap.nearbyHostiles,
      hint: this.makeHint(currentOp, targetDist),
    };
  }

  private makeHint(
    currentOp: { op: string; args: Record<string, unknown>; elapsedMs: number } | null,
    targetDist: number | null,
  ): string {
    const err = (this.lastError ?? "").toLowerCase();
    if (err.includes("destination full") || err.includes("inventory"))
      return "Inventory appears full — craft/smelt/pickup has nowhere to go. Needs inventory management.";
    if (err.includes("blockupdate") || err.includes("did not fire"))
      return "Dig was not confirmed by the server — the target block is likely unreachable or already broken.";
    if (err.includes("took to long to decide path") || err.includes("took too long"))
      return "Pathfinder could not find a route to the target (likely walled off or too far).";
    if (currentOp?.op === "dig" && targetDist !== null && targetDist > 5)
      return `Digging a block ${targetDist} away — out of reach; cannot path to it.`;
    if (currentOp?.op === "goto")
      return "Pathfinding has stalled toward the current goal.";
    if (!currentOp)
      return `No operation in flight but no progress — likely a phase retry loop. lastError=${this.lastError ?? "none"}`;
    return `Operation ${currentOp.op} made no progress. lastError=${this.lastError ?? "none"}`;
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
