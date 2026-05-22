import type { Bot } from "mineflayer";
import { HARNESS } from "./config.js";
import type { Recorder, StateData } from "./events.js";
import type { Tracer } from "./tracer.js";
import { HOSTILE_MOBS } from "../config.js";

export class Telemetry {
  private timer: ReturnType<typeof setInterval> | null = null;
  private _last: StateData | null = null;

  constructor(
    private getBot: () => Bot | null,
    private recorder: Recorder,
    private tracer: Tracer,
  ) {}

  get last(): StateData | null {
    return this._last;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), HARNESS.telemetryIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  tick(): StateData {
    const snap = this.snapshot();
    this._last = snap;
    this.recorder.record("state", snap);
    return snap;
  }

  private snapshot(): StateData {
    const bot = this.getBot();
    const activity = this.tracer.currentActivity();

    if (!bot) {
      return {
        pos: null, vel: null, health: null, food: null, oxygen: null, dimension: null,
        onGround: null, inWater: null, inLava: null,
        phase: this.tracer.phase, activity: activity.text, activityElapsedMs: activity.elapsedMs,
        inventory: [], inventoryUsedSlots: 0, nearbyEntities: [], nearbyHostiles: 0, pathGoal: null,
      };
    }

    const ent = bot.entity;
    return {
      pos: vec(ent?.position),
      vel: vec(ent?.velocity),
      health: numOrNull(bot.health),
      food: numOrNull(bot.food),
      oxygen: numOrNull((bot as any).oxygenLevel),
      dimension: (bot.game?.dimension as string) ?? null,
      onGround: ent ? !!ent.onGround : null,
      inWater: ent ? !!(ent as any).isInWater : null,
      inLava: ent ? !!(ent as any).isInLava : null,
      phase: this.tracer.phase,
      activity: activity.text,
      activityElapsedMs: activity.elapsedMs,
      inventory: this.inventory(bot),
      inventoryUsedSlots: bot.inventory ? bot.inventory.items().length : 0,
      nearbyEntities: this.nearbyEntities(bot),
      nearbyHostiles: this.nearbyHostiles(bot),
      pathGoal: this.pathGoal(bot),
    };
  }

  private inventory(bot: Bot): { name: string; count: number }[] {
    if (!bot.inventory) return [];
    const byName = new Map<string, number>();
    for (const item of bot.inventory.items()) {
      byName.set(item.name, (byName.get(item.name) ?? 0) + item.count);
    }
    return [...byName.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }

  private nearbyEntities(bot: Bot): { name: string; type: string; dist: number }[] {
    if (!bot.entity) return [];
    const me = bot.entity.position;
    const out: { name: string; type: string; dist: number }[] = [];
    for (const e of Object.values(bot.entities)) {
      if (!e || e === bot.entity || !e.position) continue;
      const dist = e.position.distanceTo(me);
      if (dist > HARNESS.nearbyEntityRadius) continue;
      out.push({ name: e.name ?? "?", type: (e as any).type ?? "?", dist: round1(dist) });
    }
    return out.sort((a, b) => a.dist - b.dist).slice(0, 20);
  }

  private nearbyHostiles(bot: Bot): number {
    if (!bot.entity) return 0;
    const me = bot.entity.position;
    let n = 0;
    for (const e of Object.values(bot.entities)) {
      if (!e || e === bot.entity || !e.position) continue;
      if (e.position.distanceTo(me) > HARNESS.nearbyEntityRadius) continue;
      if (HOSTILE_MOBS.includes(e.name as any)) n++;
    }
    return n;
  }

  private pathGoal(bot: Bot): string | null {
    const pf = (bot as any).pathfinder;
    const goal = pf?.goal;
    if (!goal) return null;
    const name = goal.constructor?.name ?? "Goal";
    if (typeof goal.x === "number") {
      return `${name}(${Math.round(goal.x)},${Math.round(goal.y ?? 0)},${Math.round(goal.z)})`;
    }
    return name;
  }
}

function vec(v: any): { x: number; y: number; z: number } | null {
  if (v && typeof v.x === "number") return { x: round2(v.x), y: round2(v.y), z: round2(v.z) };
  return null;
}
function numOrNull(n: any): number | null {
  return typeof n === "number" ? n : null;
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
