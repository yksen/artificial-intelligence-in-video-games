import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { HARNESS } from "./config.js";
import type { HarnessEvent } from "./events.js";

export function resolveRunDir(arg?: string): string {
  if (!arg) {
    const runs = listRuns();
    if (!runs.length) throw new Error(`No runs found under ${HARNESS.runsRoot}`);
    return join(HARNESS.runsRoot, runs[runs.length - 1]!);
  }
  if (isAbsolute(arg) && existsSync(arg)) return arg;
  const underRuns = join(HARNESS.runsRoot, arg);
  if (existsSync(underRuns)) return underRuns;
  if (existsSync(arg)) return arg;
  throw new Error(`Run not found: ${arg}`);
}

export function listRuns(): string[] {
  if (!existsSync(HARNESS.runsRoot)) return [];
  return readdirSync(HARNESS.runsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

export function loadEvents(runDir: string): HarnessEvent[] {
  const file = join(runDir, "events.jsonl");
  if (!existsSync(file)) throw new Error(`No events.jsonl in ${runDir}`);
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as HarnessEvent);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flags = args.filter((a) => a.startsWith("--"));
  const positional = args.filter((a) => !a.startsWith("--"));
  const onlyStuck = flags.includes("--stuck");
  const typeFlag = flags.find((f) => f.startsWith("--type="));
  const types = typeFlag ? typeFlag.slice("--type=".length).split(",") : null;

  const runDir = resolveRunDir(positional[0]);
  const events = loadEvents(runDir);
  const t0 = events[0]?.t ?? 0;

  console.log(`\n=== Replay: ${runDir} (${events.length} events) ===\n`);
  let shown = 0;
  for (const e of events) {
    if (onlyStuck && e.type !== "stuck" && e.type !== "failure") continue;
    if (types && !types.includes(e.type)) continue;
    const rel = ((e.t - t0) / 1000).toFixed(1).padStart(7);
    console.log(`+${rel}s  ${e.type.padEnd(11)}  ${summarize(e)}`);
    if ((e.type === "stuck" || e.type === "failure") && e.data) {
      const hint = (e.data as any).hint;
      if (hint) console.log(`            ↳ ${hint}`);
    }
    shown++;
  }
  console.log(`\n${shown} events shown.\n`);
}

function summarize(e: HarnessEvent): string {
  const d: any = e.data ?? {};
  switch (e.type) {
    case "log":
      return `[${d.level}] ${d.message}`;
    case "op:start":
      return `▶ ${d.op} ${args(d.args)}`;
    case "op:end":
      return `${d.outcome === "ok" ? "✔" : d.outcome === "timeout" ? "⏱" : "✗"} ${d.op} (${d.durationMs}ms)${d.error ? " — " + d.error : ""}`;
    case "mc":
      return `mc:${d.event}`;
    case "phase":
      return `phase ${d.action}: ${d.phase}`;
    case "stuck":
      return `STUCK [${d.source}] op=${d.op ?? d.currentOp?.op ?? "-"}`;
    case "failure":
      return `FAILURE ${d.reason} → ${d.file ?? ""}`;
    case "checkpoint":
      return `checkpoint ${d.action}: ${d.label ?? ""}`;
    case "state":
      return `pos ${d.pos ? `${Math.round(d.pos.x)},${Math.round(d.pos.y)},${Math.round(d.pos.z)}` : "?"} hp${d.health} food${d.food} ${d.activity ?? ""}`;
    case "server":
    case "supervisor":
      return d.message ?? "";
    case "control":
      return `${d.cmd}`;
    default:
      return JSON.stringify(d);
  }
}

function args(o: Record<string, unknown> | undefined): string {
  if (!o) return "";
  return Object.entries(o)
    .map(([k, v]) => `${k}=${typeof v === "object" && v && "x" in (v as any) ? `(${Math.round((v as any).x)},${Math.round((v as any).y)},${Math.round((v as any).z)})` : v}`)
    .join(" ");
}
