import type { Bot } from "mineflayer";
import { cpSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { HARNESS } from "./config.js";
import type { Recorder } from "./events.js";
import type { RconClient } from "./rcon.js";

export class CheckpointManager {
  private order: string[] = [];

  constructor(
    private recorder: Recorder,
    private rcon: RconClient,
  ) {}

  private get checkpointsRoot(): string {
    return join(this.recorder.runDir, "checkpoints");
  }
  private worldPath(): string {
    return join(HARNESS.serverDir, HARNESS.worldName);
  }
  private dirFor(label: string): string {
    return join(this.checkpointsRoot, sanitize(label));
  }

  async save(label: string, bot: Bot | null): Promise<string> {
    const dir = this.dirFor(label);
    const worldDest = join(dir, "world");

    try {
      await this.rcon.send("save-off");
      await this.rcon.send("save-all flush");
      await sleep(800);
    } catch (err) {
      this.recorder.record("checkpoint", { action: "save-warn", label, message: `RCON save failed: ${err}` });
    }

    try {
      if (existsSync(worldDest)) rmSync(worldDest, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      cpSync(this.worldPath(), worldDest, { recursive: true });
    } finally {
      try {
        await this.rcon.send("save-on");
      } catch {
      }
    }

    writeFileSync(join(dir, "state.json"), JSON.stringify(this.botState(label, bot), null, 2));

    if (!this.order.includes(label)) this.order.push(label);
    else {
      this.order = this.order.filter((l) => l !== label);
      this.order.push(label);
    }
    this.writeIndex();

    this.recorder.record("checkpoint", { action: "saved", label, dir });
    return dir;
  }

  hasCheckpoint(label: string): boolean {
    return existsSync(join(this.dirFor(label), "world"));
  }

  list(): string[] {
    if (this.order.length) return this.order.slice();
    if (!existsSync(this.checkpointsRoot)) return [];
    return readdirSync(this.checkpointsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  }

  latest(): string | null {
    return this.order.length ? this.order[this.order.length - 1]! : null;
  }

  restoreWorldFiles(label: string): void {
    const worldSrc = join(this.dirFor(label), "world");
    if (!existsSync(worldSrc)) throw new Error(`Checkpoint "${label}" has no world snapshot`);
    const dest = this.worldPath();
    rmSync(dest, { recursive: true, force: true });
    cpSync(worldSrc, dest, { recursive: true });
    this.recorder.record("checkpoint", { action: "restored", label });
  }

  private botState(label: string, bot: Bot | null): Record<string, unknown> {
    const inv = bot?.inventory
      ? aggregate(bot.inventory.items().map((i) => ({ name: i.name, count: i.count })))
      : [];
    return {
      label,
      savedAt: new Date().toISOString(),
      runId: this.recorder.runId,
      pos: bot?.entity?.position
        ? { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z }
        : null,
      health: bot?.health ?? null,
      food: bot?.food ?? null,
      dimension: bot?.game?.dimension ?? null,
      inventory: inv,
    };
  }

  private writeIndex(): void {
    try {
      writeFileSync(
        join(this.checkpointsRoot, "index.json"),
        JSON.stringify({ order: this.order, updatedAt: new Date().toISOString() }, null, 2),
      );
    } catch {
    }
  }
}

function aggregate(items: { name: string; count: number }[]): { name: string; count: number }[] {
  const byName = new Map<string, number>();
  for (const i of items) byName.set(i.name, (byName.get(i.name) ?? 0) + i.count);
  return [...byName.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

function sanitize(label: string): string {
  return label.replace(/[^a-z0-9-_]/gi, "_");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
