import type { Bot } from "mineflayer";
import { HARNESS } from "./config.js";
import type { Recorder } from "./events.js";

let opIdCounter = 0;

export function attachInstrumentation(bot: Bot, recorder: Recorder): void {
  tapEvents(bot, recorder);

  wrapDig(bot, recorder);
  wrapMethod(bot, "craft", "craft", recorder, HARNESS.opTimeouts.craft, (a) => ({
    count: a[1] ?? 1,
    hasTable: !!a[2],
  }));
  wrapMethod(bot, "placeBlock", "placeBlock", recorder, HARNESS.opTimeouts.placeBlock, (a) => ({
    ref: (a[0] as any)?.name,
    refPos: posObj((a[0] as any)?.position),
    face: vecObj(a[1]),
  }));
  wrapMethod(bot, "activateBlock", "activateBlock", recorder, HARNESS.opTimeouts.activateBlock, (a) => ({
    block: (a[0] as any)?.name,
    pos: posObj((a[0] as any)?.position),
  }));
  wrapMethod(bot, "consume", "consume", recorder, HARNESS.opTimeouts.consume, () => ({}));
  wrapMethod(bot, "equip", "equip", recorder, HARNESS.opTimeouts.equip, (a) => ({
    item: (a[0] as any)?.name,
    dest: a[1],
  }));

  const tryWrapPathfinder = () => {
    const pf = (bot as any).pathfinder;
    if (pf && typeof pf.goto === "function" && !pf.goto.__harnessWrapped) {
      wrapMethod(pf, "goto", "goto", recorder, HARNESS.opTimeouts.goto, (a) => ({
        goal: goalSummary(a[0]),
      }), () => {
        try {
          pf.stop();
        } catch {
        }
      });
    }
  };
  bot.once("spawn", tryWrapPathfinder);
  tryWrapPathfinder();
}

function tapEvents(bot: Bot, recorder: Recorder): void {
  const mc = (event: string, data: Record<string, unknown> = {}): void => {
    recorder.record("mc", { event, ...data });
  };

  bot.on("spawn", () => mc("spawn", { pos: posObj(bot.entity?.position), dimension: bot.game?.dimension }));
  bot.on("death", () => mc("death", { pos: posObj(bot.entity?.position) }));
  bot.on("respawn", () => mc("respawn"));
  bot.on("kicked", (reason: any) => mc("kicked", { reason: String(reason) }));
  bot.on("end", (reason: any) => mc("end", { reason: String(reason) }));
  bot.on("error", (err: any) => mc("error", { message: err?.message ?? String(err) }));

  let lastHealth = -1;
  let lastFood = -1;
  bot.on("health", () => {
    if (bot.health !== lastHealth || bot.food !== lastFood) {
      lastHealth = bot.health;
      lastFood = bot.food;
      mc("health", { health: bot.health, food: bot.food });
    }
  });

  bot.on("entityHurt", (entity: any) => {
    if (entity === bot.entity) mc("hurt", { health: bot.health });
  });
  bot.on("diggingCompleted", (block: any) => mc("digComplete", { pos: posObj(block?.position), block: block?.name }));
  bot.on("diggingAborted", (block: any) => mc("digAborted", { pos: posObj(block?.position), block: block?.name }));
  bot.on("forcedMove", () => mc("forcedMove", { pos: posObj(bot.entity?.position) }));

  bot.on("path_update" as any, (r: any) => {
    if (r?.status === "noPath" || r?.status === "timeout") {
      mc("path_" + r.status, { cost: r.cost, time: r.time, visitedNodes: r.visitedNodes });
    }
  });
  bot.on("goal_reached" as any, () => mc("goal_reached", { pos: posObj(bot.entity?.position) }));
}

function wrapMethod(
  obj: any,
  method: string,
  opName: string,
  recorder: Recorder,
  timeoutMs: number,
  makeArgs: (args: any[]) => Record<string, unknown>,
  onTimeout?: () => void,
): void {
  const orig = obj[method];
  if (typeof orig !== "function" || orig.__harnessWrapped) return;

  const wrapped = function (this: any, ...args: any[]) {
    const id = opIdCounter++;
    let summary: Record<string, unknown> = {};
    try {
      summary = makeArgs(args);
    } catch {
      summary = {};
    }
    recorder.record("op:start", { id, op: opName, args: summary });
    const start = Date.now();

    let result: any;
    try {
      result = orig.apply(this, args);
    } catch (err: any) {
      recorder.record("op:end", {
        id,
        op: opName,
        outcome: "error",
        durationMs: Date.now() - start,
        error: err?.message ?? String(err),
      });
      throw err;
    }

    if (!result || typeof result.then !== "function") {
      recorder.record("op:end", { id, op: opName, outcome: "ok", durationMs: Date.now() - start });
      return result;
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        recorder.record("op:end", {
          id,
          op: opName,
          outcome: "timeout",
          durationMs: Date.now() - start,
          error: `[harness] ${opName} exceeded ${timeoutMs}ms`,
        });
        recorder.record("stuck", {
          source: "op-timeout",
          op: opName,
          args: summary,
          timeoutMs,
        });
        try {
          onTimeout?.();
        } catch {
        }
        reject(new Error(`[harness] ${opName} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      Promise.resolve(result).then(
        (val) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          recorder.record("op:end", { id, op: opName, outcome: "ok", durationMs: Date.now() - start });
          resolve(val);
        },
        (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          recorder.record("op:end", {
            id,
            op: opName,
            outcome: "error",
            durationMs: Date.now() - start,
            error: err?.message ?? String(err),
          });
          reject(err);
        },
      );
    });
  };
  wrapped.__harnessWrapped = true;
  obj[method] = wrapped;
}

function wrapDig(bot: Bot, recorder: Recorder): void {
  wrapMethod(
    bot,
    "dig",
    "dig",
    recorder,
    HARNESS.opTimeouts.dig,
    (a) => ({ block: (a[0] as any)?.name, pos: posObj((a[0] as any)?.position) }),
    () => {
      try {
        (bot as any).stopDigging();
      } catch {
      }
    },
  );
}

function posObj(p: any): { x: number; y: number; z: number } | undefined {
  if (p && typeof p.x === "number") return { x: p.x, y: p.y, z: p.z };
  return undefined;
}

function vecObj(v: any): { x: number; y: number; z: number } | undefined {
  return posObj(v);
}

function goalSummary(goal: any): string {
  if (!goal) return "?";
  const name = goal.constructor?.name ?? "Goal";
  const coords =
    typeof goal.x === "number"
      ? `(${Math.round(goal.x)},${Math.round(goal.y ?? 0)},${Math.round(goal.z)})`
      : "";
  return `${name}${coords}`;
}
