import { join } from "node:path";
import { HARNESS } from "../config.js";
import type { HarnessEvent, Recorder } from "../events.js";
import type { TestRunner } from "./testRunner.js";

export type ControlHandler = (args: Record<string, unknown>) => void | Promise<void>;

export class Dashboard {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private clients = new Set<any>();
  private ring: HarnessEvent[] = [];
  private maxRing = 500;
  private runState = "idle";

  constructor(
    private recorder: Recorder,
    private controls: Record<string, ControlHandler> = {},
    private testRunner?: TestRunner,
  ) {
    recorder.onEvent((e) => {
      this.ring.push(e);
      if (this.ring.length > this.maxRing) this.ring.shift();
      this.broadcast({ kind: "event", event: e });
    });
    if (testRunner) {
      testRunner.onUpdate = (test) => this.broadcast({ kind: "test-update", test });
      testRunner.onLog = (name, line) => this.broadcast({ kind: "test-log", name, line });
    }
  }

  setRunState(state: string): void {
    this.runState = state;
    this.broadcast({ kind: "run-state", state });
  }

  start(): void {
    const uiPath = join(import.meta.dir, "ui.html");
    const self = this;

    this.server = Bun.serve({
      port: HARNESS.dashboardPort,
      async fetch(req, server) {
        const url = new URL(req.url);

        if (url.pathname === "/ws") {
          if ((server as any).upgrade(req)) return undefined as any;
          return new Response("WebSocket upgrade failed", { status: 400 });
        }

        if (url.pathname === "/" || url.pathname === "/index.html") {
          return new Response(Bun.file(uiPath), { headers: { "content-type": "text/html" } });
        }

        if (url.pathname === "/api/info") {
          return Response.json({
            runId: self.recorder.runId,
            viewerPort: HARNESS.viewerPort,
            viewerEnabled: HARNESS.viewerEnabled,
          });
        }

        if (url.pathname === "/api/scenarios") {
          return Response.json({
            tests: self.testRunner?.list() ?? [],
            parallel: self.testRunner?.concurrency ?? 0,
          });
        }

        return new Response("Not found", { status: 404 });
      },
      websocket: {
        open(ws) {
          self.clients.add(ws);
          ws.send(
            JSON.stringify({
              kind: "hello",
              runId: self.recorder.runId,
              viewerPort: HARNESS.viewerPort,
              viewerEnabled: HARNESS.viewerEnabled,
              controls: Object.keys(self.controls),
              history: self.ring,
              runState: self.runState,
              hasRun: "startRun" in self.controls,
              hasTests: !!self.testRunner,
              testParallel: self.testRunner?.concurrency ?? 0,
              tests: self.testRunner?.list() ?? [],
            }),
          );
        },
        close(ws) {
          self.clients.delete(ws);
        },
        async message(ws, raw) {
          let msg: any;
          try {
            msg = JSON.parse(String(raw));
          } catch {
            return;
          }
          if (msg?.kind === "test" && typeof msg.cmd === "string") {
            const tr = self.testRunner;
            if (!tr) {
              ws.send(JSON.stringify({ kind: "test-ack", cmd: msg.cmd, ok: false, error: "test runner not available" }));
              return;
            }
            const name = String(msg.args?.name ?? "");
            if (msg.cmd === "run") tr.run(name);
            else if (msg.cmd === "runAll") tr.runAll();
            else if (msg.cmd === "stop") tr.stop(name);
            else if (msg.cmd === "stopAll") tr.stopAll();
            else if (msg.cmd === "viewer") tr.setViewer(name, !!msg.args?.firstPerson);
            ws.send(JSON.stringify({ kind: "test-ack", cmd: msg.cmd, ok: true }));
            return;
          }
          if (msg?.kind === "control" && typeof msg.cmd === "string") {
            self.recorder.record("control", { cmd: msg.cmd, args: msg.args ?? {} });
            const handler = self.controls[msg.cmd];
            if (handler) {
              try {
                await handler(msg.args ?? {});
                ws.send(JSON.stringify({ kind: "control-ack", cmd: msg.cmd, ok: true }));
              } catch (err: any) {
                ws.send(JSON.stringify({ kind: "control-ack", cmd: msg.cmd, ok: false, error: String(err?.message ?? err) }));
              }
            } else {
              ws.send(JSON.stringify({ kind: "control-ack", cmd: msg.cmd, ok: false, error: "unknown command" }));
            }
          }
        },
      },
    });

    this.recorder.record("supervisor", {
      message: `Dashboard running on http://localhost:${HARNESS.dashboardPort}`,
    });
  }

  private broadcast(payload: unknown): void {
    const data = JSON.stringify(payload);
    for (const ws of this.clients) {
      try {
        ws.send(data);
      } catch {
      }
    }
  }

  stop(): void {
    try {
      this.testRunner?.stopAll();
    } catch {
    }
    this.server?.stop(true);
    this.server = null;
  }
}
