import type { Bot } from "mineflayer";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HarnessEvent, Recorder } from "./events.js";
import type { Telemetry } from "./telemetry.js";
import type { Tracer } from "./tracer.js";

export class Diagnostics {
  private ring: HarnessEvent[] = [];
  private maxEvents: number;

  screenshotProvider: (() => Promise<string | null>) | null = null;

  constructor(
    private recorder: Recorder,
    private getBot: () => Bot | null,
    private telemetry: Telemetry,
    private tracer: Tracer,
    maxEvents = 200,
  ) {
    this.maxEvents = maxEvents;
    recorder.onEvent((e) => {
      this.ring.push(e);
      if (this.ring.length > this.maxEvents) this.ring.shift();
    });
  }

  async capture(reason: string, extra: Record<string, unknown> = {}): Promise<string> {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const safeReason = reason.replace(/[^a-z0-9-]/gi, "-").slice(0, 40);
    const fileName = `${ts}-${safeReason}.json`;
    const filePath = join(this.recorder.runDir, "diagnostics", fileName);

    let screenshot: string | null = null;
    if (this.screenshotProvider) {
      try {
        screenshot = await this.screenshotProvider();
      } catch {
        screenshot = null;
      }
    }

    const bundle = {
      reason,
      capturedAt: new Date().toISOString(),
      runId: this.recorder.runId,
      seqAtCapture: this.recorder.currentSeq,
      snapshot: this.telemetry.last,
      activity: {
        phase: this.tracer.phase,
        phaseIndex: this.tracer.phaseIndex,
        currentOp: this.tracer.currentOp(),
        ...this.tracer.currentActivity(),
      },
      nearbyBlocks: this.scanNearbyBlocks(4),
      recentEvents: this.ring.slice(),
      screenshotFile: screenshot,
      ...extra,
    };

    writeFileSync(filePath, JSON.stringify(bundle, null, 2));
    this.recorder.record("failure", { reason, file: fileName, hint: (extra as any)?.hint ?? null });
    return filePath;
  }

  private scanNearbyBlocks(radius: number): Record<string, number> {
    const bot = this.getBot();
    const counts: Record<string, number> = {};
    if (!bot || !bot.entity) return counts;
    const base = bot.entity.position.floored();
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const b = bot.blockAt(base.offset(dx, dy, dz));
          if (b && b.name && b.name !== "air") {
            counts[b.name] = (counts[b.name] ?? 0) + 1;
          }
        }
      }
    }
    return counts;
  }
}
