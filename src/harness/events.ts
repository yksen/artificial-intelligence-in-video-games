import { EventEmitter } from "node:events";
import { mkdirSync, createWriteStream, type WriteStream } from "node:fs";
import { join } from "node:path";


export type HarnessEventType =
  | "state"
  | "op:start"
  | "op:end"
  | "mc"
  | "log"
  | "phase"
  | "checkpoint"
  | "stuck"
  | "failure"
  | "server"
  | "supervisor"
  | "control";

export interface HarnessEvent<T = any> {
  t: number;
  iso: string;
  seq: number;
  type: HarnessEventType;
  data: T;
}

export interface OpStartData {
  id: number;
  op: string;
  args: Record<string, unknown>;
}
export interface OpEndData {
  id: number;
  op: string;
  outcome: "ok" | "error" | "timeout";
  durationMs: number;
  error?: string;
}
export interface LogData {
  level: string;
  message: string;
}
export interface PhaseData {
  action: "start" | "complete" | "fail";
  phase: string;
  index?: number;
  total?: number;
}
export interface StateData {
  pos: { x: number; y: number; z: number } | null;
  vel: { x: number; y: number; z: number } | null;
  health: number | null;
  food: number | null;
  oxygen: number | null;
  dimension: string | null;
  onGround: boolean | null;
  inWater: boolean | null;
  inLava: boolean | null;
  phase: string | null;
  activity: string | null;
  activityElapsedMs: number | null;
  inventory: { name: string; count: number }[];
  inventoryUsedSlots: number;
  nearbyEntities: { name: string; type: string; dist: number }[];
  nearbyHostiles: number;
  pathGoal: string | null;
}

export class Recorder {
  readonly runId: string;
  readonly runDir: string;
  readonly bus = new EventEmitter();

  private seq = 0;
  private eventsStream: WriteStream;
  private telemetryStream: WriteStream;
  private closed = false;

  constructor(runsRoot: string, runId?: string) {
    this.runId = runId ?? makeRunId();
    this.runDir = join(runsRoot, this.runId);
    mkdirSync(join(this.runDir, "diagnostics"), { recursive: true });
    mkdirSync(join(this.runDir, "checkpoints"), { recursive: true });
    this.eventsStream = createWriteStream(join(this.runDir, "events.jsonl"), { flags: "a" });
    this.telemetryStream = createWriteStream(join(this.runDir, "telemetry.jsonl"), { flags: "a" });
    this.bus.setMaxListeners(0);
  }

  record<T>(type: HarnessEventType, data: T): HarnessEvent<T> {
    const now = Date.now();
    const evt: HarnessEvent<T> = {
      t: now,
      iso: new Date(now).toISOString(),
      seq: this.seq++,
      type,
      data,
    };

    if (!this.closed) {
      const line = JSON.stringify(evt) + "\n";
      this.eventsStream.write(line);
      if (type === "state") this.telemetryStream.write(line);
    }

    this.bus.emit("event", evt);
    this.bus.emit(type, evt);
    return evt;
  }

  onEvent(fn: (evt: HarnessEvent) => void): () => void {
    this.bus.on("event", fn);
    return () => this.bus.off("event", fn);
  }

  get currentSeq(): number {
    return this.seq;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.eventsStream.end();
    this.telemetryStream.end();
  }
}

export function makeRunId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ts}-${rand}`;
}
