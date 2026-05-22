import type { Bot } from "mineflayer";
import { HARNESS } from "./config.js";
import type { Recorder } from "./events.js";

export class ViewerManager {
  private current: Bot | null = null;
  private firstPerson: boolean = HARNESS.viewerFirstPerson;

  constructor(private recorder: Recorder) {}

  attach(bot: Bot): void {
    if (!HARNESS.viewerEnabled) return;
    this.close();
    this.scheduleAttach(bot, 0);
  }

  setFirstPerson(on: boolean): void {
    this.firstPerson = on;
    const bot = this.current;
    this.close();
    this.recorder.record("supervisor", { message: `viewer follow ${on ? "ON (first-person)" : "OFF (orbit)"}` });
    if (bot) this.scheduleAttach(bot, 600);
  }

  private scheduleAttach(bot: Bot, delayMs: number): void {
    const doAttach = () => {
      try {
        const pv = require("prismarine-viewer");
        pv.mineflayer(bot, {
          port: HARNESS.viewerPort,
          firstPerson: this.firstPerson,
          viewDistance: HARNESS.viewerViewDistance,
        });
        this.current = bot;
        this.recorder.record("supervisor", {
          message: `prismarine-viewer (${this.firstPerson ? "first-person" : "orbit"}) on http://localhost:${HARNESS.viewerPort}`,
        });
      } catch (err: any) {
        this.recorder.record("supervisor", {
          message: `viewer unavailable (continuing without 3D view): ${err?.message ?? err}`,
        });
      }
    };
    const start = (): void => {
      if (delayMs > 0) setTimeout(doAttach, delayMs);
      else doAttach();
    };
    if (bot.entity) start();
    else bot.once("spawn", start);
  }

  close(): void {
    const prev = this.current as any;
    if (prev?.viewer?.close) {
      try {
        prev.viewer.close();
      } catch {
      }
    }
    this.current = null;
  }
}
