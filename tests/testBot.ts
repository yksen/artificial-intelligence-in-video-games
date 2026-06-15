import mineflayer from "mineflayer";
import type { Bot } from "mineflayer";
import { pathfinder } from "mineflayer-pathfinder";
import { plugin as collectBlock } from "mineflayer-collectblock";
import { plugin as pvp } from "mineflayer-pvp";
import { plugin as tool } from "mineflayer-tool";
import { BOT_CONFIG } from "../src/config.js";
import { shouldEat, eatFood, isInLavaOrFire, escapeLavaOrFire } from "../src/utils/survival.js";
import { logger } from "../src/logger.js";
import { botEvents } from "../src/events.js";
import { bindSession, loadMcData, type PhaseContext } from "../src/runtime.js";

export function phaseContext(bot: Bot, phaseName = "scenario"): PhaseContext {
  const signal = new AbortController().signal;
  bindSession(bot, signal);
  return { bot, mcData: loadMcData(bot), signal, events: botEvents, log: logger.scoped(phaseName) };
}

export function createTestBot(spawnTimeoutMs = 60_000): Promise<Bot> {
  const bot = mineflayer.createBot({
    host: BOT_CONFIG.host,
    port: BOT_CONFIG.port,
    username: BOT_CONFIG.username,
    version: BOT_CONFIG.version,
  });

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(collectBlock);
  bot.loadPlugin(pvp);
  bot.loadPlugin(tool);
  bot.setMaxListeners(50);

  let busy = false;
  bot.on("health", () => {
    if (busy) return;
    void (async () => {
      busy = true;
      try {
        if (isInLavaOrFire(bot)) await escapeLavaOrFire(bot);
        else if (shouldEat(bot)) await eatFood(bot);
      } catch {
      } finally {
        busy = false;
      }
    })();
  });

  return new Promise<Bot>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Bot did not spawn within ${spawnTimeoutMs}ms`)), spawnTimeoutMs);
    bot.once("spawn", () => {
      clearTimeout(timer);
      resolve(bot);
    });
    bot.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
