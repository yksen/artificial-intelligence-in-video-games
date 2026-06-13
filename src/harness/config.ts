import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export const PROJECT_ROOT = resolve(import.meta.dir, "..", "..");

function detectJavaBin(): string {
  if (process.env.JAVA_BIN) return process.env.JAVA_BIN;
  const candidates = [
    "/usr/lib/jvm/java-11-temurin-jdk/bin/java",
    "/usr/lib/jvm/temurin-11-jdk/bin/java",
    "/usr/lib/jvm/java-8-temurin-jdk/bin/java",
    "/usr/lib/jvm/java-16-openjdk/bin/java",
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return "java";
}

function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v === "1" || v.toLowerCase() === "true";
}

export const HARNESS = {
  projectRoot: PROJECT_ROOT,
  serverDir: process.env.MC_SERVER_DIR ?? join(PROJECT_ROOT, "server"),
  serverJar: process.env.MC_SERVER_JAR ?? "server.jar",
  worldName: process.env.MC_WORLD_NAME ?? "world",
  runsRoot: process.env.RUN_DIR ?? join(PROJECT_ROOT, "runs"),

  javaBin: detectJavaBin(),
  mcRam: process.env.MC_RAM ?? "2G",
  mcViewDistance: envNum("MC_VIEW_DISTANCE", 8),
  serverReadyRegex: /Done \([\d.]+s\)! For help/,
  serverReadyTimeoutMs: envNum("MC_READY_TIMEOUT_MS", 120_000),
  serverStopTimeoutMs: envNum("MC_STOP_TIMEOUT_MS", 30_000),

  levelSeed: process.env.LEVEL_SEED ?? "",
  levelType: process.env.MC_LEVEL_TYPE ?? "default",
  generateStructures: envBool("MC_GENERATE_STRUCTURES", true),
  spawnProtection: envNum("MC_SPAWN_PROTECTION", 0),
  difficulty: process.env.DIFFICULTY ?? "easy",
  freshWorld: envBool("FRESH_WORLD", false),

  rconPort: envNum("RCON_PORT", 25575),
  rconPassword: process.env.RCON_PASSWORD ?? "speedrun-harness",

  botHost: process.env.BOT_HOST ?? "localhost",
  botPort: envNum("BOT_PORT", 25565),
  botUsername: process.env.BOT_USERNAME ?? "Bot",
  mcVersion: process.env.MC_VERSION ?? "1.16.1",

  dashboardPort: envNum("DASHBOARD_PORT", 3008),
  viewerPort: envNum("VIEWER_PORT", 3007),
  viewerEnabled: envBool("VIEWER_ENABLED", true),
  viewerFirstPerson: envBool("VIEWER_FIRST_PERSON", false),
  viewerViewDistance: envNum("VIEWER_VIEW_DISTANCE", 3),

  telemetryIntervalMs: envNum("TELEMETRY_INTERVAL_MS", 1500),
  nearbyEntityRadius: envNum("NEARBY_ENTITY_RADIUS", 16),

  opTimeouts: {
    dig: envNum("OP_TIMEOUT_DIG_MS", 12_000),
    goto: envNum("OP_TIMEOUT_GOTO_MS", 30_000),
    craft: envNum("OP_TIMEOUT_CRAFT_MS", 8_000),
    placeBlock: envNum("OP_TIMEOUT_PLACE_MS", 8_000),
    activateBlock: envNum("OP_TIMEOUT_ACTIVATE_MS", 8_000),
    consume: envNum("OP_TIMEOUT_CONSUME_MS", 8_000),
    equip: envNum("OP_TIMEOUT_EQUIP_MS", 5_000),
    default: envNum("OP_TIMEOUT_DEFAULT_MS", 15_000),
  },

  watchdog: {
    enabled: envBool("WATCHDOG_ENABLED", true),
    checkIntervalMs: envNum("WATCHDOG_CHECK_MS", 2_000),
    noProgressMs: envNum("WATCHDOG_NO_PROGRESS_MS", 40_000),
    posEpsilon: envNum("WATCHDOG_POS_EPSILON", 0.5),
  },

  restart: {
    enabled: envBool("RESTART_ENABLED", true),
    maxRestarts: envNum("RESTART_MAX", 10),
    maxDeathsPerPhase: envNum("RESTART_MAX_DEATHS_PER_PHASE", 3),
    restoreCheckpointOnStuck: envBool("RESTART_RESTORE_ON_STUCK", true),
    cooldownMs: envNum("RESTART_COOLDOWN_MS", 5_000),
  },

  autoCheckpointOnPhaseComplete: envBool("AUTO_CHECKPOINT", true),
} as const;

export type HarnessConfig = typeof HARNESS;
