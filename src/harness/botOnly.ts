import mineflayer from "mineflayer";
import type { Bot } from "mineflayer";
import { HARNESS } from "./config.js";
import { Recorder } from "./events.js";
import { logger } from "../logger.js";
import { RconClient } from "./rcon.js";
import { Tracer } from "./tracer.js";
import { Telemetry } from "./telemetry.js";
import { Watchdog } from "./watchdog.js";
import { Diagnostics } from "./diagnostics.js";
import { CheckpointManager } from "./checkpoint.js";
import { ViewerManager } from "./viewer.js";
import { Dashboard } from "./dashboard/server.js";
import { TestRunner } from "./dashboard/testRunner.js";
import { attachInstrumentation } from "./instrument.js";
import { MinecraftBot } from "../bot.js";

async function main(): Promise<void> {
  const recorder = new Recorder(HARNESS.runsRoot);
  const tracer = new Tracer(recorder);
  let bot: Bot | null = null;
  let mcBot: MinecraftBot | null = null;

  const telemetry = new Telemetry(() => bot, recorder, tracer);
  const watchdog = new Watchdog(recorder, telemetry, tracer);
  const diagnostics = new Diagnostics(recorder, () => bot, telemetry, tracer);
  const viewer = new ViewerManager(recorder);
  const rcon = new RconClient();
  const checkpoints = new CheckpointManager(recorder, rcon);

  const spawn = () => {
    mcBot = new MinecraftBot();
  };

  const dashboard = new Dashboard(recorder, {
    checkpoint: async (a) => {
      await checkpoints.save(String((a as any).label ?? "manual"), bot);
    },
    restartBot: async () => {
      try {
        mcBot?.dispose();
      } catch {
      }
      bot = null;
      await new Promise((r) => setTimeout(r, 500));
      spawn();
    },
    viewerFollow: async (args) => {
      viewer.setFirstPerson(!!(args as any).on);
    },
  }, new TestRunner());

  logger.addSink((level, message) => {
    recorder.record("log", { level, message });
    let m: RegExpMatchArray | null;
    if ((m = message.match(/Starting phase (\d+)\/(\d+): (.+)$/))) {
      recorder.record("phase", { action: "start", phase: m[3]!, index: +m[1]! - 1, total: +m[2]! });
    } else if ((m = message.match(/Phase "(.+?)" completed successfully/))) {
      recorder.record("phase", { action: "complete", phase: m[1]! });
    } else if ((m = message.match(/Phase "(.+?)" failed/))) {
      recorder.record("phase", { action: "fail", phase: m[1]! });
    } else if ((m = message.match(/Waiting ~(\d+)s for smelting/))) {
      watchdog.grantGrace((+m[1]! + 30) * 1000);
    }
  });

  watchdog.onStuck = (d) => {
    void diagnostics.capture("stuck", { diagnosis: d, hint: d.hint });
  };

  const orig = (mineflayer as any).createBot;
  (mineflayer as any).createBot = (opts: any) => {
    const b = orig(opts) as Bot;
    bot = b;
    b.setMaxListeners(50);
    attachInstrumentation(b, recorder);
    viewer.attach(b);
    b.on("death", () => void diagnostics.capture("death"));
    return b;
  };

  dashboard.start();
  rcon.connect(3, 500).catch(() => logger.warn("[bot-only] RCON not available; checkpoints disabled"));
  telemetry.start();
  watchdog.start();
  spawn();

  logger.info(
    `[bot-only] Dashboard http://localhost:${HARNESS.dashboardPort} | 3D view http://localhost:${HARNESS.viewerPort}`,
  );
}

main();
