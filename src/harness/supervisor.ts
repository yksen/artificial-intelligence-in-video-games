import mineflayer from "mineflayer";
import type { Bot } from "mineflayer";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { HARNESS } from "./config.js";
import { Recorder } from "./events.js";
import { logger } from "../logger.js";
import { MinecraftServerController } from "./server.js";
import { RconClient } from "./rcon.js";
import { Tracer } from "./tracer.js";
import { Telemetry } from "./telemetry.js";
import { Watchdog, type StuckDiagnosis } from "./watchdog.js";
import { Diagnostics } from "./diagnostics.js";
import { CheckpointManager } from "./checkpoint.js";
import { ViewerManager } from "./viewer.js";
import { Dashboard, type ControlHandler } from "./dashboard/server.js";
import { TestRunner } from "./dashboard/testRunner.js";
import { attachInstrumentation } from "./instrument.js";
import { MinecraftBot } from "../bot.js";

export class Supervisor {
  private recorder: Recorder;
  private server: MinecraftServerController;
  private rcon: RconClient;
  private tracer: Tracer;
  private telemetry: Telemetry;
  private watchdog: Watchdog;
  private diagnostics: Diagnostics;
  private checkpoints: CheckpointManager;
  private viewer: ViewerManager;
  private dashboard: Dashboard;

  private bot: Bot | null = null;
  private mcBot: MinecraftBot | null = null;

  private restartCount = 0;
  private deathsByPhase = new Map<string, number>();
  private shuttingDown = false;
  private paused = false;
  private restarting = false;
  private patched = false;
  private startedAt = Date.now();
  private lastOpTimeoutCaptureAt = 0;
  private runActive = false;
  private runTransition = false;
  private currentSeed = HARNESS.levelSeed;

  constructor() {
    this.recorder = new Recorder(HARNESS.runsRoot);
    this.server = new MinecraftServerController(this.recorder);
    this.rcon = new RconClient();
    this.tracer = new Tracer(this.recorder);
    this.telemetry = new Telemetry(() => this.bot, this.recorder, this.tracer);
    this.watchdog = new Watchdog(this.recorder, this.telemetry, this.tracer);
    this.diagnostics = new Diagnostics(this.recorder, () => this.bot, this.telemetry, this.tracer);
    this.checkpoints = new CheckpointManager(this.recorder, this.rcon);
    this.viewer = new ViewerManager(this.recorder);
    this.dashboard = new Dashboard(this.recorder, this.controls(), new TestRunner());

    this.watchdog.onStuck = (d) => void this.handleStuck(d);
    this.server.onCrash = (code, signal) => void this.handleServerCrash(code, signal);

    this.recorder.bus.on("stuck", (e: any) => {
      if (e?.data?.source === "op-timeout") this.maybeCaptureOpTimeout(e.data);
    });

    this.installLogSink();
  }

  get runDir(): string {
    return this.recorder.runDir;
  }


  async run(): Promise<void> {
    this.installSignalHandlers();
    this.dashboard.start();
    this.dashboard.setRunState("idle");
    this.sup(`Dashboard ready on http://localhost:${HARNESS.dashboardPort} — idle.`);
    this.sup(`Start a run from the Monitor tab, or run scenarios from the Tests tab.`);
  }

  async startRun(opts: { seed?: string } = {}): Promise<void> {
    if (this.runTransition) throw new Error("a run start/stop is already in progress");
    if (this.runActive) throw new Error("a run is already active — stop it first");
    this.runTransition = true;
    try {
      this.dashboard.setRunState("starting");
      await this.teardownRun();

      this.shuttingDown = false;
      this.paused = false;
      this.restarting = false;
      this.restartCount = 0;
      this.deathsByPhase.clear();

      const seed = (opts.seed && opts.seed.trim()) || randomSeed();
      this.currentSeed = seed;
      this.server.beginFreshWorld(seed);
      this.sup(`Starting run — fresh world, seed ${seed}`);
      this.writeMeta("running");

      try {
        await this.server.start();
      } catch (err) {
        this.sup(`FATAL: server failed to start: ${err}`);
        await this.teardownRun();
        this.dashboard.setRunState("idle");
        return;
      }

      try {
        await this.rcon.connect();
        this.sup("RCON connected");
        await this.applyWorldRules();
      } catch (err) {
        this.sup(`RCON unavailable (checkpoints disabled): ${err}`);
      }

      this.telemetry.start();
      this.watchdog.start();
      this.runActive = true;
      this.spawnBot();
      this.dashboard.setRunState("running");
      this.sup("Bot launched. Watching for stalls / deaths / crashes.");
    } finally {
      this.runTransition = false;
    }
  }

  async stopRun(): Promise<void> {
    if (this.runTransition) throw new Error("a run start/stop is already in progress");
    if (!this.runActive && !this.server.running) {
      this.dashboard.setRunState("idle");
      return;
    }
    this.runTransition = true;
    try {
      this.dashboard.setRunState("stopping");
      this.sup("Stopping run.");
      this.writeMeta("stopped");
      await this.teardownRun();
      this.dashboard.setRunState("idle");
    } finally {
      this.runTransition = false;
    }
  }

  private async teardownRun(): Promise<void> {
    this.runActive = false;
    this.telemetry.stop();
    this.watchdog.stop();
    this.retireBot();
    this.viewer.close();
    await this.rcon.close();
    await this.server.stop();
  }

  private spawnBot(): void {
    this.patchCreateBot();
    this.mcBot = new MinecraftBot();
  }

  private patchCreateBot(): void {
    if (this.patched) return;
    this.patched = true;
    const orig = (mineflayer as any).createBot;
    (mineflayer as any).createBot = (opts: any) => {
      const bot = orig(opts) as Bot;
      this.onBotCreated(bot);
      return bot;
    };
  }

  private onBotCreated(bot: Bot): void {
    this.bot = bot;
    bot.setMaxListeners(50);
    attachInstrumentation(bot, this.recorder);
    this.viewer.attach(bot);
    bot.on("death", () => void this.handleDeath());
    bot.on("end", (reason: any) => void this.handleBotEnd(String(reason)));
  }


  private async beginRestart(reason: string): Promise<boolean> {
    if (this.shuttingDown || !this.runActive) return false;
    if (this.paused) {
      this.sup(`Restart suppressed (paused): ${reason}`);
      return false;
    }
    if (this.restarting) return false;
    if (!HARNESS.restart.enabled) {
      this.sup(`Restart disabled by config: ${reason}`);
      return false;
    }
    this.restartCount++;
    this.writeMeta("running");
    if (this.restartCount > HARNESS.restart.maxRestarts) {
      await this.giveUp(`exceeded ${HARNESS.restart.maxRestarts} restarts`);
      return false;
    }
    this.restarting = true;
    await sleep(HARNESS.restart.cooldownMs);
    return true;
  }

  private async restartBot(reason: string): Promise<void> {
    if (!(await this.beginRestart(reason))) return;
    try {
      this.sup(`Restarting bot: ${reason}`);
      this.retireBot();
      await sleep(500);
      this.spawnBot();
    } finally {
      this.restarting = false;
    }
  }

  private async restartServer(reason: string): Promise<void> {
    if (!(await this.beginRestart(reason))) return;
    try {
      this.sup(`Restarting server: ${reason}`);
      this.retireBot();
      await this.rcon.close();
      await this.server.stop();
      await this.server.start();
      await this.reconnectRcon();
      this.spawnBot();
    } finally {
      this.restarting = false;
    }
  }

  private async restartFromCheckpoint(label: string, reason: string): Promise<void> {
    if (!this.checkpoints.hasCheckpoint(label)) {
      this.sup(`No checkpoint "${label}" — falling back to bot restart`);
      return this.restartBot(reason);
    }
    if (!(await this.beginRestart(reason))) return;
    try {
      this.sup(`Restoring checkpoint "${label}": ${reason}`);
      this.retireBot();
      await this.rcon.close();
      await this.server.stop();
      this.checkpoints.restoreWorldFiles(label);
      await this.server.start();
      await this.reconnectRcon();
      this.spawnBot();
    } finally {
      this.restarting = false;
    }
  }

  private retireBot(): void {
    try {
      this.mcBot?.dispose();
    } catch {
    }
    this.mcBot = null;
    this.bot = null;
  }

  private async reconnectRcon(): Promise<void> {
    try {
      await this.rcon.connect();
      await this.applyWorldRules();
    } catch (err) {
      this.sup(`RCON reconnect failed: ${err}`);
    }
  }

  private async applyWorldRules(): Promise<void> {
    if (!this.rcon.connected) return;
    try {
      await this.rcon.send("gamerule keepInventory true");
      await this.rcon.send("gamerule doImmediateRespawn true");
      this.sup("World rules set: keepInventory=true, doImmediateRespawn=true");
    } catch (err) {
      this.sup(`Failed to set world rules: ${err}`);
    }
  }


  private async handleDeath(): Promise<void> {
    if (this.shuttingDown || !this.runActive) return;
    const phase = this.tracer.phase ?? "unknown";
    const n = (this.deathsByPhase.get(phase) ?? 0) + 1;
    this.deathsByPhase.set(phase, n);
    this.sup(`Bot died in phase "${phase}" (death #${n} this phase)`);
    await this.diagnostics.capture("death", { phase, deathsThisPhase: n }).catch(() => {});

    if (n >= HARNESS.restart.maxDeathsPerPhase && this.checkpoints.hasCheckpoint(phase)) {
      this.sup(`${n} deaths in "${phase}" — restoring its checkpoint`);
      await this.restartFromCheckpoint(phase, `repeated deaths in ${phase}`);
    }
  }

  private maybeCaptureOpTimeout(data: { op?: string; args?: unknown; timeoutMs?: number }): void {
    const now = Date.now();
    if (now - this.lastOpTimeoutCaptureAt < 60_000) return;
    this.lastOpTimeoutCaptureAt = now;
    const hint = `Operation "${data.op}" exceeded ${data.timeoutMs}ms and was cancelled (likely unreachable target / pathfinder failure).`;
    void this.diagnostics.capture("op-timeout", { op: data.op, args: data.args, timeoutMs: data.timeoutMs, hint });
  }

  private async handleStuck(diag: StuckDiagnosis): Promise<void> {
    if (this.shuttingDown || !this.runActive) return;
    this.sup(`STUCK in "${diag.phase}": ${diag.hint}`);
    await this.diagnostics.capture("stuck", { diagnosis: diag, hint: diag.hint }).catch(() => {});
    if (this.paused) {
      this.sup("Paused — leaving the bot as-is for inspection (no auto-restart).");
      return;
    }
    const latest = this.checkpoints.latest();
    if (HARNESS.restart.restoreCheckpointOnStuck && latest) {
      await this.restartFromCheckpoint(latest, "stuck");
    } else {
      await this.restartBot("stuck");
    }
  }

  private async handleBotEnd(reason: string): Promise<void> {
    if (this.shuttingDown || this.restarting || !this.runActive) return;
    if (!this.server.running) return;
    this.sup(`Bot disconnected unexpectedly (${reason}) — reconnecting`);
    await this.restartBot(`bot 'end': ${reason}`);
  }

  private async handleServerCrash(code: number | null, signal: string | null): Promise<void> {
    if (this.shuttingDown || !this.runActive) return;
    this.sup(`Server crashed (code=${code}, signal=${signal}) — restarting server + bot`);
    await this.diagnostics.capture("server-crash", { code, signal }).catch(() => {});
    if (!(await this.beginRestart("server-crash"))) return;
    try {
      this.retireBot();
      await this.rcon.close();
      await this.server.start();
      await this.reconnectRcon();
      this.spawnBot();
    } finally {
      this.restarting = false;
    }
  }


  private controls(): Record<string, ControlHandler> {
    return {
      startRun: async (args) => {
        await this.startRun({ seed: (args as any)?.seed });
      },
      stopRun: async () => {
        await this.stopRun();
      },
      checkpoint: async (args) => {
        const label = String((args as any).label ?? "manual");
        await this.checkpoints.save(label, this.bot);
      },
      restoreLast: async () => {
        const l = this.checkpoints.latest();
        if (!l) throw new Error("no checkpoints yet");
        await this.restartFromCheckpoint(l, "manual restore");
      },
      restartBot: async () => this.restartBot("manual"),
      restartServer: async () => this.restartServer("manual"),
      pause: async () => {
        this.paused = true;
        this.sup("Paused (auto-restart suspended; movement halted).");
        try {
          (this.bot as any)?.pathfinder?.stop?.();
        } catch {
        }
      },
      resume: async () => {
        this.paused = false;
        this.sup("Resumed.");
      },
      viewerFollow: async (args) => {
        this.viewer.setFirstPerson(!!(args as any).on);
      },
    };
  }


  private installLogSink(): void {
    logger.addSink((level, message) => {
      this.recorder.record("log", { level, message });

      let m: RegExpMatchArray | null;
      if ((m = message.match(/Starting phase (\d+)\/(\d+): (.+)$/))) {
        this.recorder.record("phase", {
          action: "start",
          phase: m[3]!,
          index: parseInt(m[1]!, 10) - 1,
          total: parseInt(m[2]!, 10),
        });
      } else if ((m = message.match(/Phase "(.+?)" completed successfully/))) {
        this.recorder.record("phase", { action: "complete", phase: m[1]! });
        if (HARNESS.autoCheckpointOnPhaseComplete && this.rcon.connected) {
          this.checkpoints
            .save(m[1]!, this.bot)
            .catch((err) => this.sup(`auto-checkpoint failed: ${err}`));
        }
      } else if ((m = message.match(/Phase "(.+?)" failed/))) {
        this.recorder.record("phase", { action: "fail", phase: m[1]! });
      } else if ((m = message.match(/Waiting ~(\d+)s for smelting/))) {
        this.watchdog.grantGrace((parseInt(m[1]!, 10) + 30) * 1000);
      }
    });
  }

  private sup(message: string): void {
    console.log(`[harness] ${message}`);
    this.recorder.record("supervisor", { message });
  }

  private writeMeta(outcome: string): void {
    try {
      writeFileSync(
        join(this.recorder.runDir, "meta.json"),
        JSON.stringify(
          {
            runId: this.recorder.runId,
            startedAt: new Date(this.startedAt).toISOString(),
            updatedAt: new Date().toISOString(),
            outcome,
            restartCount: this.restartCount,
            deathsByPhase: Object.fromEntries(this.deathsByPhase),
            config: {
              mcVersion: HARNESS.mcVersion,
              javaBin: HARNESS.javaBin,
              levelSeed: this.currentSeed || "(world default)",
              difficulty: HARNESS.difficulty,
              freshWorld: HARNESS.freshWorld,
              dashboardPort: HARNESS.dashboardPort,
              viewerPort: HARNESS.viewerPort,
            },
          },
          null,
          2,
        ),
      );
    } catch {
    }
  }

  private async giveUp(reason: string): Promise<void> {
    this.sup(`GIVING UP: ${reason}. Tearing the run down; dashboard stays up for a fresh start.`);
    this.writeMeta("gave-up");
    await this.teardownRun();
    this.dashboard.setRunState("idle");
  }

  private installSignalHandlers(): void {
    const onSignal = (sig: string) => {
      this.sup(`Received ${sig}`);
      void this.shutdown(sig).then(() => process.exit(0));
    };
    process.on("SIGINT", () => onSignal("SIGINT"));
    process.on("SIGTERM", () => onSignal("SIGTERM"));
    process.on("uncaughtException", (err) => {
      this.sup(`uncaughtException: ${err?.message ?? err}`);
      this.diagnostics.capture("uncaught-exception", { message: String(err?.message ?? err) }).catch(() => {});
    });
    process.on("unhandledRejection", (reason) => {
      this.sup(`unhandledRejection: ${reason}`);
    });
  }

  async shutdown(reason: string): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.runActive = false;
    this.sup(`Shutting down: ${reason}`);
    this.writeMeta("stopped");
    this.telemetry.stop();
    this.watchdog.stop();
    this.retireBot();
    this.viewer.close();
    await this.rcon.close();
    await this.server.stop();
    this.dashboard.stop();
    this.recorder.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function randomSeed(): string {
  const hi = BigInt(Math.floor(Math.random() * 0x100000000));
  const lo = BigInt(Math.floor(Math.random() * 0x100000000));
  return (((hi << 32n) | lo) & ((1n << 63n) - 1n)).toString();
}
