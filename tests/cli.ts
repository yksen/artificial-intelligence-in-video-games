import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import { PROJECT_ROOT } from "../src/harness/config.js";
import { allScenarios, getScenario, type Scenario } from "./scenario.js";
import "./scenarios/index.js";

interface CliResult {
  name: string;
  status: "pass" | "fail" | "error" | "timeout";
  durationMs: number;
  error?: string;
}

const WORK_ROOT = join(PROJECT_ROOT, ".scenario-work");

function parseArgs(argv: string[]) {
  const names: string[] = [];
  let parallel = 2;
  let keep = false;
  let list = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--parallel" || a === "-p") parallel = Math.max(1, parseInt(argv[++i] ?? "2"));
    else if (a === "--keep") keep = true;
    else if (a === "--list" || a === "-l") list = true;
    else if (a === "all") { }
    else names.push(a);
  }
  return { names, parallel, keep, list };
}

function runScenario(scenario: Scenario, index: number, keep: boolean): Promise<CliResult> {
  const botPort = 26000 + index * 10;
  const rconPort = botPort + 1;
  const workDir = join(WORK_ROOT, scenario.name);
  if (!keep && existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  const env = {
    ...process.env,
    SCENARIO: scenario.name,
    SCENARIO_WORK_DIR: workDir,
    MC_SERVER_DIR: join(workDir, "server"),
    MC_WORLD_NAME: "world",
    FRESH_WORLD: "true",
    MC_LEVEL_TYPE: "flat",
    MC_GENERATE_STRUCTURES: "false",
    MC_SPAWN_PROTECTION: "0",
    DIFFICULTY: scenario.difficulty ?? "peaceful",
    VIEWER_ENABLED: "false",
    MC_RAM: process.env.SCENARIO_MC_RAM ?? "1G",
    MC_VIEW_DISTANCE: "4",
    BOT_PORT: String(botPort),
    RCON_PORT: String(rconPort),
  };

  const logPath = join(workDir, "child.log");
  const logStream = createWriteStream(logPath, { flags: "w" });
  const started = Date.now();

  return new Promise<CliResult>((resolve) => {
    const child = spawn(process.execPath, [join(PROJECT_ROOT, "tests", "runOne.ts")], {
      cwd: PROJECT_ROOT,
      env,
    });
    child.stdout.on("data", (b) => logStream.write(b));
    child.stderr.on("data", (b) => logStream.write(b));

    child.on("exit", () => {
      logStream.end();
      let res: CliResult = { name: scenario.name, status: "error", durationMs: Date.now() - started };
      try {
        const parsed = JSON.parse(readFileSync(join(workDir, "result.json"), "utf8"));
        res = { name: scenario.name, status: parsed.status, durationMs: parsed.durationMs, error: parsed.error };
      } catch {
        res.error = `no result.json (see ${logPath})`;
      }
      resolve(res);
    });
    child.on("error", (err) => {
      logStream.end();
      resolve({ name: scenario.name, status: "error", durationMs: Date.now() - started, error: String(err) });
    });
  });
}

async function runPool(scenarios: Scenario[], parallel: number, keep: boolean): Promise<CliResult[]> {
  const results: CliResult[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(parallel, scenarios.length) }, async (_, slot) => {
    while (true) {
      const i = next++;
      if (i >= scenarios.length) break;
      const s = scenarios[i]!;
      console.log(`[slot ${slot}] ▶ ${s.name}`);
      const r = await runScenario(s, i, keep);
      const icon = r.status === "pass" ? "✓" : "✗";
      console.log(`[slot ${slot}] ${icon} ${s.name} — ${r.status} (${(r.durationMs / 1000).toFixed(1)}s)`);
      results.push(r);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main(): Promise<void> {
  const { names, parallel, keep, list } = parseArgs(process.argv.slice(2));

  if (list) {
    for (const s of allScenarios()) console.log(`${s.name}${s.description ? `  — ${s.description}` : ""}`);
    return;
  }

  let scenarios: Scenario[];
  if (names.length === 0) {
    scenarios = allScenarios();
  } else {
    scenarios = [];
    for (const n of names) {
      const s = getScenario(n);
      if (!s) { console.error(`Unknown scenario: ${n}`); process.exit(2); }
      scenarios.push(s);
    }
  }

  if (scenarios.length === 0) { console.error("No scenarios registered."); process.exit(2); }

  console.log(`Running ${scenarios.length} scenario(s), parallelism ${parallel}\n`);
  const results = await runPool(scenarios, parallel, keep);

  console.log("\n──────── Summary ────────");
  results.sort((a, b) => a.name.localeCompare(b.name));
  let failed = 0;
  for (const r of results) {
    const icon = r.status === "pass" ? "✓" : "✗";
    if (r.status !== "pass") failed++;
    const err = r.error ? `  (${r.error})` : "";
    console.log(`${icon} ${r.name.padEnd(28)} ${r.status.padEnd(8)} ${(r.durationMs / 1000).toFixed(1)}s${err}`);
  }
  console.log(`\n${results.length - failed}/${results.length} passed.`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
