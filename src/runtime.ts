import type { Bot } from "mineflayer";
import type { LogWriter } from "./logger.js";
import type { BotEventChannel } from "./events.js";

export interface PhaseContext {
  bot: Bot;
  mcData: McData;
  signal: AbortSignal;
  events: BotEventChannel;
  log: LogWriter;
}

export interface McData {
  blocksByName: Record<string, { id: number } | undefined>;
  itemsByName: Record<string, { id: number } | undefined>;
  [key: string]: unknown;
}

const mcDataCache = new Map<string, McData>();

export function loadMcData(bot: Bot): McData {
  const version = bot.version;
  let data = mcDataCache.get(version);
  if (!data) {
    data = require("minecraft-data")(version) as McData;
    mcDataCache.set(version, data);
  }
  return data;
}

interface BotSession {
  signal: AbortSignal;
  reflexActive: boolean;
}

const sessions = new WeakMap<Bot, BotSession>();

export function bindSession(bot: Bot, signal: AbortSignal): void {
  sessions.set(bot, { signal, reflexActive: false });
}

export class RunAbortedError extends Error {
  constructor() {
    super("[bot] run aborted (death/restart) — unwinding stale phase");
    this.name = "RunAbortedError";
  }
}

export function throwIfAborted(bot: Bot): void {
  if (sessions.get(bot)?.signal.aborted) throw new RunAbortedError();
}

export function isAborted(bot: Bot): boolean {
  return sessions.get(bot)?.signal.aborted ?? false;
}

export function beginReflex(bot: Bot): void {
  const s = sessions.get(bot);
  if (s) s.reflexActive = true;
}

export function endReflex(bot: Bot): void {
  const s = sessions.get(bot);
  if (s) s.reflexActive = false;
}

export function reflexActive(bot: Bot): boolean {
  return sessions.get(bot)?.reflexActive ?? false;
}

export async function yieldToReflex(bot: Bot, pollMs = 100, maxWaitMs = 15_000): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  while (reflexActive(bot) && !isAborted(bot) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throwIfAborted(bot);
}
