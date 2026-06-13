import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, createWriteStream, rmSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import { HARNESS } from "./config.js";
import type { Recorder } from "./events.js";

type ServerState = "idle" | "starting" | "running" | "stopping" | "stopped";

export class MinecraftServerController {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private state: ServerState = "idle";
  private logStream: WriteStream | null = null;
  private expectRunning = false;
  private bootedOnce = false;
  private exitGuard: (() => void) | null = null;

  private levelSeed: string = HARNESS.levelSeed;
  private freshWorld: boolean = HARNESS.freshWorld;

  onCrash: ((code: number | null, signal: string | null) => void) | null = null;

  constructor(private recorder: Recorder) {}

  beginFreshWorld(seed: string): void {
    this.levelSeed = seed;
    this.freshWorld = true;
    this.bootedOnce = false;
  }

  get seed(): string {
    return this.levelSeed;
  }

  get running(): boolean {
    return this.state === "running";
  }

  private record(message: string, extra: Record<string, unknown> = {}): void {
    this.recorder.record("server", { message, state: this.state, ...extra });
  }

  private writeManagedProperties(): void {
    const propsPath = join(HARNESS.serverDir, "server.properties");
    const managed: Record<string, string> = {
      "enable-rcon": "true",
      "rcon.port": String(HARNESS.rconPort),
      "rcon.password": HARNESS.rconPassword,
      "broadcast-rcon-to-ops": "false",
      "level-name": HARNESS.worldName,
      difficulty: HARNESS.difficulty,
      "online-mode": "false",
      "server-port": String(HARNESS.botPort),
      "view-distance": String(HARNESS.mcViewDistance),
      "level-type": HARNESS.levelType,
      "generate-structures": String(HARNESS.generateStructures),
      "spawn-protection": String(HARNESS.spawnProtection),
    };
    if (this.levelSeed) managed["level-seed"] = this.levelSeed;

    let lines: string[] = [];
    if (existsSync(propsPath)) {
      lines = readFileSync(propsPath, "utf8").split("\n");
    }

    const seen = new Set<string>();
    const out = lines.map((line) => {
      const m = line.match(/^([a-zA-Z0-9._-]+)=(.*)$/);
      if (!m) return line;
      const key = m[1]!;
      if (key in managed) {
        seen.add(key);
        return `${key}=${managed[key]}`;
      }
      return line;
    });
    for (const [key, value] of Object.entries(managed)) {
      if (!seen.has(key)) out.push(`${key}=${value}`);
    }

    writeFileSync(propsPath, out.join("\n"));
    this.record("Wrote managed server.properties", { managedKeys: Object.keys(managed) });
  }

  async start(): Promise<void> {
    if (this.proc) throw new Error("Server already started");

    if (this.freshWorld && !this.bootedOnce) {
      const worldPath = join(HARNESS.serverDir, HARNESS.worldName);
      if (existsSync(worldPath)) {
        rmSync(worldPath, { recursive: true, force: true });
        this.record("Wiped world for FRESH_WORLD run", { worldPath });
      }
    }
    this.bootedOnce = true;

    this.writeManagedProperties();

    this.state = "starting";
    this.expectRunning = true;
    this.logStream = createWriteStream(join(this.recorder.runDir, "server.log"), { flags: "a" });

    const args = [
      `-Xmx${HARNESS.mcRam}`,
      `-Xms${HARNESS.mcRam}`,
      "-jar",
      HARNESS.serverJar,
      "nogui",
    ];
    this.record(`Launching server: ${HARNESS.javaBin} ${args.join(" ")}`, { cwd: HARNESS.serverDir });

    this.proc = spawn(HARNESS.javaBin, args, {
      cwd: HARNESS.serverDir,
    }) as ChildProcessWithoutNullStreams;

    const child = this.proc;
    this.exitGuard = () => {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          child.kill("SIGKILL");
        } catch {
        }
      }
    };
    process.on("exit", this.exitGuard);

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const readyTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`Server did not become ready within ${HARNESS.serverReadyTimeoutMs}ms`));
        }
      }, HARNESS.serverReadyTimeoutMs);

      const onLine = (line: string) => {
        if (!line.trim()) return;
        this.logStream?.write(line + "\n");
        if (this.state === "starting" && HARNESS.serverReadyRegex.test(line)) {
          this.state = "running";
          this.record("Server ready");
          if (!settled) {
            settled = true;
            clearTimeout(readyTimer);
            resolve();
          }
        }
      };

      this.proc!.stdout.on("data", (buf: Buffer) => splitLines(buf, onLine));
      this.proc!.stderr.on("data", (buf: Buffer) => splitLines(buf, onLine));

      this.proc!.on("exit", (code, signal) => {
        const wasExpected = this.expectRunning;
        this.state = "stopped";
        if (this.exitGuard) {
          process.removeListener("exit", this.exitGuard);
          this.exitGuard = null;
        }
        this.logStream?.end();
        this.record(`Server process exited`, { code, signal, wasExpected });
        this.proc = null;
        if (!settled) {
          settled = true;
          clearTimeout(readyTimer);
          reject(new Error(`Server exited during startup (code=${code}, signal=${signal})`));
        } else if (wasExpected && this.onCrash) {
          this.onCrash(code, signal);
        }
      });

      this.proc!.on("error", (err) => {
        this.record(`Server process error: ${err.message}`);
        if (!settled) {
          settled = true;
          clearTimeout(readyTimer);
          reject(err);
        }
      });
    });
  }

  writeStdin(command: string): void {
    this.proc?.stdin.write(command + "\n");
  }

  async stop(): Promise<void> {
    if (!this.proc) return;
    this.expectRunning = false;
    this.state = "stopping";
    this.record("Stopping server");

    const proc = this.proc;
    const exited = new Promise<void>((resolve) => proc.once("exit", () => resolve()));

    try {
      proc.stdin.write("stop\n");
    } catch {
    }

    const timer = setTimeout(() => {
      this.record("Server stop timed out, sending SIGTERM");
      try {
        proc.kill("SIGTERM");
      } catch {
      }
      setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
        }
      }, 5_000);
    }, HARNESS.serverStopTimeoutMs);

    await exited;
    clearTimeout(timer);
    this.state = "stopped";
    this.proc = null;
  }
}

function splitLines(buf: Buffer, onLine: (line: string) => void): void {
  const text = buf.toString("utf8");
  for (const line of text.split(/\r?\n/)) onLine(line);
}
