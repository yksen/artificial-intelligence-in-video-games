import type { Bot } from "mineflayer";
import type { RconClient } from "../src/harness/rcon.js";


export interface ScenarioCtx {
  bot: Bot;
  rcon: RconClient;
  botName: string;
  origin: { x: number; y: number; z: number };

  cmd(command: string): Promise<string>;
  setblock(x: number, y: number, z: number, block: string): Promise<void>;
  fill(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, block: string): Promise<void>;
  give(item: string, count?: number): Promise<void>;
  clearInventory(): Promise<void>;
  tp(x: number, y: number, z: number): Promise<void>;
  forceload(x: number, z: number, radiusChunks?: number): Promise<void>;
  wait(ms: number): Promise<void>;
}

export interface Scenario {
  name: string;
  description?: string;
  difficulty?: "peaceful" | "easy" | "normal" | "hard";
  timeoutMs?: number;
  setup(ctx: ScenarioCtx): Promise<void>;
  run(ctx: ScenarioCtx): Promise<void>;
  success(ctx: ScenarioCtx): boolean | Promise<boolean>;
}

const REGISTRY = new Map<string, Scenario>();

export function defineScenario(s: Scenario): Scenario {
  if (REGISTRY.has(s.name)) throw new Error(`Duplicate scenario name: ${s.name}`);
  REGISTRY.set(s.name, s);
  return s;
}

export function getScenario(name: string): Scenario | undefined {
  return REGISTRY.get(name);
}

export function allScenarios(): Scenario[] {
  return [...REGISTRY.values()];
}
