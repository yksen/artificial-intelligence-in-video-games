import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import { PROJECT_ROOT } from "../config.js";
import { allScenarios, getScenario } from "../../../tests/scenario.js";
import "../../../tests/scenarios/index.js";

export type TestStatus =
  | "idle"
  | "queued"
  | "booting"
  | "setup"
  | "running"
  | "pass"
  | "fail"
  | "error"
  | "timeout"
  | "stopped";

export interface TestState {
  name: string;
  description?: string;
  difficulty?: string;
  status: TestStatus;
  viewerPort?: number;
  viewerFirstPerson?: boolean;
  startedAt?: number;
  durationMs?: number;
  error?: string;
}

const WORK_ROOT = join(PROJECT_ROOT, ".scenario-work");
const BOT_PORT_BASE = 26100;
const VIEWER_PORT_BASE = 27100;

const ACTIVE: TestStatus[] = ["queued", "booting", "setup", "running"];

export class TestRunner {
  private states = new Map<string, TestState>();
  private procs = new Map<string, ChildProcess>();
  private slotForName = new Map<string, number>();
  private slots: boolean[] = [];
  private queue: string[] = [];
  private stopping = new Set<string>();

  readonly concurrency: number;

  onUpdate: (state: TestState) => void = () => {};
  onLog: (name: string, line: string) => void = () => {};

  constructor(parallel = Number(process.env.TEST_DASHBOARD_PARALLEL ?? 2)) {
    this.concurrency = Math.max(1, Number.isFinite(parallel) ? parallel : 2);
    for (const s of allScenarios()) {
      this.states.set(s.name, {
        name: s.name,
        description: s.description,
        difficulty: s.difficulty,
        status: "idle",
      });
    }
  }

  list(): TestState[] {
    return [...this.states.values()];
  }

  run(name: string): void {
    const scenario = getScenario(name);
    const st = this.states.get(name);
    if (!scenario || !st) return;
    if (ACTIVE.includes(st.status)) return;
    st.status = "queued";
    st.error = undefined;
    st.durationMs = undefined;
    st.viewerPort = undefined;
    st.startedAt = undefined;
    this.emit(st);
    this.queue.push(name);
    this.pump();
  }

  runAll(): void {
    for (const s of allScenarios()) this.run(s.name);
  }

  stop(name: string): void {
    const child = this.procs.get(name);
    const st = this.states.get(name);
    if (child) {
      this.stopping.add(name);
      if (st) {
        st.status = "stopped";
        st.viewerPort = undefined;
        this.emit(st);
      }
      this.killGroup(child);
    } else if (st && st.status === "queued") {
      this.queue = this.queue.filter((n) => n !== name);
      st.status = "idle";
      this.emit(st);
    }
  }

  stopAll(): void {
    this.queue = [];
    for (const name of [...this.procs.keys()]) this.stop(name);
  }

  setViewer(name: string, firstPerson: boolean): void {
    const child = this.procs.get(name);
    if (!child?.stdin?.writable) return;
    try {
      child.stdin.write(`@@CMD ${JSON.stringify({ cmd: "viewer", firstPerson })}\n`);
    } catch {
    }
  }


  private pump(): void {
    while (this.procs.size < this.concurrency && this.queue.length) {
      const name = this.queue.shift()!;
      const st = this.states.get(name);
      if (!st || st.status !== "queued") continue;
      this.launch(name);
    }
  }

  private takeSlot(): number {
    for (let i = 0; i < this.slots.length; i++) {
      if (!this.slots[i]) {
        this.slots[i] = true;
        return i;
      }
    }
    this.slots.push(true);
    return this.slots.length - 1;
  }

  private launch(name: string): void {
    const scenario = getScenario(name)!;
    const slot = this.takeSlot();
    this.slotForName.set(name, slot);

    const botPort = BOT_PORT_BASE + slot * 10;
    const rconPort = botPort + 1;
    const viewerPort = VIEWER_PORT_BASE + slot;
    const workDir = join(WORK_ROOT, name);
    if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
    mkdirSync(workDir, { recursive: true });

    const env = {
      ...process.env,
      SCENARIO: name,
      SCENARIO_WORK_DIR: workDir,
      MC_SERVER_DIR: join(workDir, "server"),
      MC_WORLD_NAME: "world",
      FRESH_WORLD: "true",
      MC_LEVEL_TYPE: "flat",
      MC_GENERATE_STRUCTURES: "false",
      MC_SPAWN_PROTECTION: "0",
      DIFFICULTY: scenario.difficulty ?? "peaceful",
      VIEWER_ENABLED: "true",
      VIEWER_PORT: String(viewerPort),
      VIEWER_VIEW_DISTANCE: process.env.TEST_VIEWER_VIEW_DISTANCE ?? "2",
      MC_RAM: process.env.SCENARIO_MC_RAM ?? "1G",
      MC_VIEW_DISTANCE: "4",
      BOT_PORT: String(botPort),
      RCON_PORT: String(rconPort),
    };

    const st = this.states.get(name)!;
    st.status = "booting";
    st.startedAt = Date.now();
    st.viewerPort = undefined;
    st.error = undefined;
    st.durationMs = undefined;
    this.emit(st);

    const logPath = join(workDir, "child.log");
    const logStream = createWriteStream(logPath, { flags: "w" });
    const child = spawn(process.execPath, [join(PROJECT_ROOT, "tests", "runOne.ts")], {
      cwd: PROJECT_ROOT,
      env,
      detached: true,
    });
    this.procs.set(name, child);

    let buf = "";
    const onData = (b: Buffer) => {
      logStream.write(b);
      buf += b.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        this.handleLine(name, line);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    child.on("exit", () => {
      logStream.end();
      this.procs.delete(name);
      this.slots[slot] = false;
      this.slotForName.delete(name);
      const st = this.states.get(name)!;
      st.viewerPort = undefined;
      const wasStopped = this.stopping.delete(name);
      try {
        const parsed = JSON.parse(readFileSync(join(workDir, "result.json"), "utf8"));
        st.status = parsed.status;
        st.durationMs = parsed.durationMs;
        st.error = parsed.error;
      } catch {
        if (wasStopped || st.status === "stopped") {
          st.status = "stopped";
        } else {
          st.status = "error";
          st.error = `no result.json (see ${logPath})`;
        }
      }
      this.emit(st);
      this.pump();
    });

    child.on("error", (err) => {
      this.procs.delete(name);
      this.slots[slot] = false;
      this.slotForName.delete(name);
      this.stopping.delete(name);
      const st = this.states.get(name)!;
      st.status = "error";
      st.viewerPort = undefined;
      st.error = String(err);
      this.emit(st);
      this.pump();
    });
  }

  private handleLine(name: string, line: string): void {
    if (line.startsWith("@@SCN ")) {
      try {
        const ev = JSON.parse(line.slice(6));
        const st = this.states.get(name);
        if (!st) return;
        if (st.status === "stopped") return;
        if (ev.ev === "setup") st.status = "setup";
        else if (ev.ev === "run") st.status = "running";
        else if (ev.ev === "viewer" && typeof ev.port === "number") {
          st.viewerPort = ev.port;
          if (typeof ev.firstPerson === "boolean") st.viewerFirstPerson = ev.firstPerson;
        }
        this.emit(st);
      } catch {
      }
      return;
    }
    this.onLog(name, line);
  }

  private killGroup(child: ChildProcess): void {
    try {
      if (child.pid) process.kill(-child.pid, "SIGTERM");
      else child.kill("SIGTERM");
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {
      }
    }
  }

  private emit(st: TestState): void {
    this.onUpdate({ ...st });
  }
}
