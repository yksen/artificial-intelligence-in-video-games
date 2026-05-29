import { existsSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import type { Bot } from "mineflayer";
import { HARNESS, PROJECT_ROOT } from "../src/harness/config.js";
import { Recorder } from "../src/harness/events.js";
import { MinecraftServerController } from "../src/harness/server.js";
import { RconClient } from "../src/harness/rcon.js";
import { getScenario, type Scenario, type ScenarioCtx } from "./scenario.js";
import "./scenarios/index.js";
import { createTestBot } from "./testBot.js";
import type { ViewerManager } from "../src/harness/viewer.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function emitStatus(ev: Record<string, unknown>): void {
  try {
    process.stdout.write(`@@SCN ${JSON.stringify(ev)}\n`);
  } catch {
  }
}

interface Result {
  name: string;
  status: "pass" | "fail" | "error" | "timeout";
  durationMs: number;
  error?: string;
  inventory?: { name: string; count: number }[];
}

function prepareServerDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const jarLink = join(dir, HARNESS.serverJar);
  if (!existsSync(jarLink)) {
    symlinkSync(join(PROJECT_ROOT, "server", "server.jar"), jarLink);
  }
  writeFileSync(join(dir, "eula.txt"), "eula=true\n");
}

function makeCtx(bot: Bot, rcon: RconClient, origin: ScenarioCtx["origin"]): ScenarioCtx {
  const cmd = (c: string) => rcon.send(c);
  const name = HARNESS.botUsername;
  return {
    bot,
    rcon,
    botName: name,
    origin,
    cmd,
    setblock: async (x, y, z, block) => void (await cmd(`setblock ${x} ${y} ${z} ${block}`)),
    fill: async (x1, y1, z1, x2, y2, z2, block) => void (await cmd(`fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} ${block}`)),
    give: async (item, count = 1) => void (await cmd(`give ${name} ${item} ${count}`)),
    clearInventory: async () => void (await cmd(`clear ${name}`)),
    tp: async (x, y, z) => void (await cmd(`tp ${name} ${x} ${y} ${z}`)),
    forceload: async (x, z, r = 1) => void (await cmd(`forceload add ${x - r * 16} ${z - r * 16} ${x + r * 16} ${z + r * 16}`)),
    wait: sleep,
  };
}

async function applyBaseRules(rcon: RconClient): Promise<void> {
  for (const rule of [
    "gamerule keepInventory true",
    "gamerule doImmediateRespawn true",
    "gamerule doDaylightCycle false",
    "gamerule doWeatherCycle false",
    "gamerule doMobSpawning false",
    "gamerule mobGriefing false",
    "time set day",
    "weather clear",
  ]) {
    try { await rcon.send(rule); } catch { }
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} exceeded ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

async function main(): Promise<void> {
  const scenarioName = process.env.SCENARIO;
  const workDir = process.env.SCENARIO_WORK_DIR ?? join(PROJECT_ROOT, ".scenario-work", scenarioName ?? "unknown");
  const scenario = scenarioName ? getScenario(scenarioName) : undefined;
  const started = Date.now();
  const result: Result = { name: scenarioName ?? "?", status: "error", durationMs: 0 };

  const writeResult = () => {
    result.durationMs = Date.now() - started;
    try { writeFileSync(join(workDir, "result.json"), JSON.stringify(result, null, 2)); } catch { }
  };

  if (!scenario) {
    result.error = `Unknown scenario: ${scenarioName}`;
    mkdirSync(workDir, { recursive: true });
    writeResult();
    process.exit(2);
  }

  const worldPath = join(HARNESS.serverDir, HARNESS.worldName);
  if (existsSync(worldPath)) rmSync(worldPath, { recursive: true, force: true });
  prepareServerDir(HARNESS.serverDir);

  const recorder = new Recorder(workDir, "instance");
  const server = new MinecraftServerController(recorder);
  const rcon = new RconClient();
  let bot: Bot | null = null;

  try {
    await server.start();
    await rcon.connect();
    await applyBaseRules(rcon);

    const origin = { x: 0, y: 4, z: 0 };
    await rcon.send(`forceload add ${origin.x - 48} ${origin.z - 48} ${origin.x + 48} ${origin.z + 48}`);

    bot = await createTestBot();
    const ctx = makeCtx(bot, rcon, origin);
    await ctx.cmd(`gamemode survival ${ctx.botName}`);

    let viewer: ViewerManager | null = null;
    let viewerFirstPerson = HARNESS.viewerFirstPerson;
    if (HARNESS.viewerEnabled) {
      try {
        const { ViewerManager } = await import("../src/harness/viewer.js");
        viewer = new ViewerManager(recorder);
        viewer.attach(bot);
        setTimeout(() => emitStatus({ ev: "viewer", port: HARNESS.viewerPort, firstPerson: viewerFirstPerson }), 2500);
      } catch { }
    }

    process.stdin.on("data", (b: Buffer) => {
      for (const line of b.toString().split("\n")) {
        if (!line.startsWith("@@CMD ")) continue;
        try {
          const cmd = JSON.parse(line.slice(6));
          if (cmd.cmd === "viewer" && viewer) {
            viewerFirstPerson = !!cmd.firstPerson;
            viewer.setFirstPerson(viewerFirstPerson);
            setTimeout(() => emitStatus({ ev: "viewer", port: HARNESS.viewerPort, firstPerson: viewerFirstPerson }), 1800);
          }
        } catch { }
      }
    });

    await sleep(500);

    const budget = scenario.timeoutMs ?? 180_000;
    await withTimeout((async () => {
      emitStatus({ ev: "setup" });
      await scenario.setup(ctx);
      await sleep(500);
      emitStatus({ ev: "run" });
      await scenario.run(ctx);
    })(), budget, `Scenario "${scenario.name}"`);

    const ok = await scenario.success(ctx);
    result.status = ok ? "pass" : "fail";
    result.inventory = bot.inventory.items().map((i) => ({ name: i.name, count: i.count }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.status = /exceeded \d+ms/.test(msg) ? "timeout" : "error";
    result.error = msg;
    if (bot) {
      try { result.inventory = bot.inventory.items().map((i) => ({ name: i.name, count: i.count })); } catch { }
    }
  } finally {
    try { bot?.quit(); } catch { }
    try { await rcon.close(); } catch { }
    try { await server.stop(); } catch { }
    recorder.close();
    writeResult();
  }

  process.exit(result.status === "pass" ? 0 : 1);
}

void main();
