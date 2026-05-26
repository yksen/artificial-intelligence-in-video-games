import mineflayer from "mineflayer";
import { pathfinder } from "mineflayer-pathfinder";
import { plugin as collectBlock } from "mineflayer-collectblock";
import { plugin as pvp } from "mineflayer-pvp";
import { plugin as tool } from "mineflayer-tool";
import { logger } from "./logger.js";
import { BOT_CONFIG } from "./config.js";
import type { Phase } from "./types.js";
import { gatherWoodPhase } from "./phases/gatherWood.js";
import { stoneAgePhase } from "./phases/stoneAge.js";
import { gatherFoodPhase } from "./phases/gatherFood.js";
import { ironAgePhase } from "./phases/ironAge.js";
import { diamondMiningPhase } from "./phases/diamondMining.js";
import { netherPortalPhase } from "./phases/netherPortal.js";
import { netherResourcesPhase } from "./phases/netherResources.js";
import { eyesOfEnderPhase } from "./phases/eyesOfEnder.js";
import { enterEndPhase } from "./phases/enterEnd.js";
import { shouldEat, eatFood, isDrowning, escapeWater, isInLavaOrFire, escapeLavaOrFire } from "./utils/survival.js";
import { shouldFlee, getNearbyHostiles, flee } from "./utils/combat.js";
import { lootNearbyChests } from "./utils/environment.js";
import { equipBestArmor, freeInventory } from "./utils/inventory.js";
import { sleep, goToY } from "./utils/navigation.js";

export class MinecraftBot {
  private bot: mineflayer.Bot;
  private phases: Phase[];
  private currentPhaseIndex: number = 0;
  private isRunning: boolean = false;
  private isSurvivalInterrupt: boolean = false;
  private spawnCount: number = 0;
  private runId: number = 0;
  private disposed: boolean = false;
  private phaseAttempts: Map<number, number> = new Map();
  private readonly maxPhaseAttempts: number = 3;

  constructor() {
    logger.info("Creating bot...");
    logger.info(`Connecting to ${BOT_CONFIG.host}:${BOT_CONFIG.port} as ${BOT_CONFIG.username}`);

    this.bot = mineflayer.createBot({
      host: BOT_CONFIG.host,
      port: BOT_CONFIG.port,
      username: BOT_CONFIG.username,
      version: BOT_CONFIG.version,
    });

    this.phases = [
      gatherWoodPhase,
      stoneAgePhase,
      gatherFoodPhase,
      ironAgePhase,
      diamondMiningPhase,
      netherPortalPhase,
      netherResourcesPhase,
      eyesOfEnderPhase,
      enterEndPhase,
    ];

    this.registerPlugins();
    this.registerEventHandlers();
  }

  private registerPlugins(): void {
    this.bot.loadPlugin(pathfinder);
    this.bot.loadPlugin(collectBlock);
    this.bot.loadPlugin(pvp);
    this.bot.loadPlugin(tool);
    logger.info("Plugins loaded: pathfinder, collectblock, pvp, tool");
  }

  private registerEventHandlers(): void {
    this.bot.on("spawn", () => {
      if (this.disposed) return;
      this.spawnCount++;
      if (this.spawnCount === 1) {
        logger.info("Bot spawned in the world");
        logger.info(`Position: ${this.bot.entity.position}`);
        logger.info(`Dimension: ${this.bot.game.dimension}`);
        logger.info(`Health: ${this.bot.health}, Food: ${this.bot.food}`);
        this.start();
      } else {
        logger.info("Respawned! Re-assessing inventory and determining restart phase...");
        this.onRespawn();
      }
    });

    this.bot.on("death", () => {
      logger.error("Bot died!");
      this.isRunning = false;
      this.runId++;
      (this.bot as any).__halt = true;
      try { this.bot.pathfinder.stop(); } catch {}
    });

    this.bot.on("health", () => {
      this.handleSurvivalInterrupt();
    });

    this.bot.on("kicked", (reason) => {
      logger.error(`Bot was kicked: ${reason}`);
      this.isRunning = false;
    });

    this.bot.on("error", (err) => {
      logger.error(`Bot error: ${err.message}`);
    });

    this.bot.on("end", (reason) => {
      logger.info(`Bot disconnected: ${reason}`);
      this.isRunning = false;
    });
  }

  private async handleSurvivalInterrupt(): Promise<void> {
    if (this.isSurvivalInterrupt) return;

    if (isInLavaOrFire(this.bot)) {
      this.isSurvivalInterrupt = true;
      try {
        await escapeLavaOrFire(this.bot);
      } catch (err) {
        logger.warn(`Failed to escape lava/fire: ${err}`);
      }
      this.isSurvivalInterrupt = false;
      return;
    }

    if (isDrowning(this.bot)) {
      this.isSurvivalInterrupt = true;
      logger.warn(`Drowning interrupt: oxygen=${(this.bot as any).oxygenLevel ?? "?"}`);
      try {
        await escapeWater(this.bot);
      } catch (err) {
        logger.warn(`Failed to escape water: ${err}`);
      }
      this.isSurvivalInterrupt = false;
    }

    if (shouldEat(this.bot)) {
      this.isSurvivalInterrupt = true;
      logger.info(`Hunger interrupt: food=${this.bot.food}/20`);
      try {
        await eatFood(this.bot);
      } catch (err) {
        logger.warn(`Failed to eat during interrupt: ${err}`);
      }
      this.isSurvivalInterrupt = false;
    }

    if (shouldFlee(this.bot)) {
      this.isSurvivalInterrupt = true;
      const hostiles = getNearbyHostiles(this.bot, 8);
      if (hostiles.length > 0) {
        logger.warn(`Danger! Health=${this.bot.health}/20, ${hostiles.length} hostile(s) nearby`);
        await flee(this.bot, hostiles[0]!);
        await eatFood(this.bot);
      }
      this.isSurvivalInterrupt = false;
    }
  }

  private async onRespawn(): Promise<void> {
    if (this.disposed) return;
    await sleep(3000);

    logger.info("Re-assessing inventory after respawn...");
    const items = this.bot.inventory.items();
    logger.info(`Inventory: ${items.length} item stacks`);
    for (const item of items) {
      logger.debug(`  ${item.name} x${item.count}`);
    }

    this.currentPhaseIndex = 0;
    for (let i = 0; i < this.phases.length; i++) {
      const phase = this.phases[i]!;
      if (phase.canSkip(this.bot)) {
        logger.info(`Phase "${phase.name}" can be skipped`);
        this.currentPhaseIndex = i + 1;
      } else {
        break;
      }
    }

    if (this.currentPhaseIndex < this.phases.length) {
      logger.info(`Restarting from phase: ${this.phases[this.currentPhaseIndex]!.name}`);
      this.isRunning = false;
      await this.start();
    }
  }

  async start(): Promise<void> {
    if (this.disposed) return;
    if (this.isRunning) {
      logger.warn("start() called while already running, ignoring");
      return;
    }
    this.isRunning = true;
    this.runId++;
    const myRunId = this.runId;
    (this.bot as any).__halt = false;

    logger.info("=== Starting bot progression ===");

    await this.waitForInventoryReady();
    if (this.runId !== myRunId) return;

    if ((this.bot.game as any).dimension === "the_end") {
      logger.info("Already in the End! Goal achieved.");
      this.isRunning = false;
      return;
    }

    try {
      await equipBestArmor(this.bot);
    } catch {
    }

    try {
      await lootNearbyChests(this.bot, 16);
    } catch {
    }

    const firstNeededPhase = this.phases.findIndex(p => !p.canSkip(this.bot));
    const currentY = Math.floor(this.bot.entity.position.y);
    if (firstNeededPhase < 4 && currentY < 50) {
      logger.info(`Underground at Y=${currentY} but need surface phases, navigating up...`);
      try {
        await goToY(this.bot, 64);
        logger.info(`Reached surface at Y=${Math.floor(this.bot.entity.position.y)}`);
      } catch (err) {
        logger.warn(`Failed to reach surface: ${err}`);
      }
    }

    for (let i = this.currentPhaseIndex; i < this.phases.length; i++) {
      if (!this.isRunning || this.runId !== myRunId) {
        logger.info("Bot stopped or restarted, halting phase execution");
        break;
      }

      const phase = this.phases[i]!;

      if (phase.canSkip(this.bot)) {
        logger.info(`Skipping phase: ${phase.name} (already completed)`);
        continue;
      }

      this.currentPhaseIndex = i;
      logger.info(`Starting phase ${i + 1}/${this.phases.length}: ${phase.name}`);

      try {
        await phase.execute(this.bot);
        if (this.runId !== myRunId) break;
        logger.info(`Phase "${phase.name}" completed successfully`);
        this.phaseAttempts.delete(i);
      } catch (err) {
        if (this.runId !== myRunId) break;
        logger.error(`Phase "${phase.name}" failed: ${err}`);

        logger.info(`Retrying phase: ${phase.name}`);
        try {
          await sleep(3000);
          if (this.runId !== myRunId) break;
          await phase.execute(this.bot);
          if (this.runId !== myRunId) break;
          logger.info(`Phase "${phase.name}" succeeded on retry`);
          this.phaseAttempts.delete(i);
        } catch (retryErr) {
          if (this.runId !== myRunId) break;
          logger.error(`Phase "${phase.name}" failed on retry: ${retryErr}`);

          const attempts = (this.phaseAttempts.get(i) ?? 0) + 1;
          this.phaseAttempts.set(i, attempts);
          if (attempts >= this.maxPhaseAttempts) {
            logger.error(
              `Phase "${phase.name}" failed ${attempts}x — halting; supervisor/watchdog will take over`,
            );
            this.isRunning = false;
            return;
          }

          logger.error(
            `Bot cannot progress; retrying phase "${phase.name}" in 10s (attempt ${attempts}/${this.maxPhaseAttempts})`,
          );
          this.isRunning = false;
          await sleep(10000);
          this.currentPhaseIndex = i;
          this.start();
          return;
        }
      }

      try {
        await freeInventory(this.bot);
        if (shouldEat(this.bot)) await eatFood(this.bot);
        await equipBestArmor(this.bot);
      } catch {
      }

      this.logInventorySummary();
    }

    if (this.isRunning) {
      logger.info("=== All phases completed! ===");
      const dim = (this.bot.game as any).dimension;
      if (dim === "the_end") {
        logger.info("=== GOAL ACHIEVED: Bot reached the End! ===");
      } else if (dim === "the_nether") {
        logger.info("=== Milestone: Bot is in the Nether ===");
      }
    }

    this.isRunning = false;
  }

  private async waitForInventoryReady(maxWaitMs: number = 3000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (this.bot.inventory.items().length > 0) return;
      await sleep(200);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.isRunning = false;
    this.runId++;
    try {
      (this.bot as any).pathfinder?.stop?.();
    } catch {}
    try {
      this.bot.removeAllListeners();
    } catch {}
    try {
      this.bot.quit("harness: retiring instance");
    } catch {}
  }

  private logInventorySummary(): void {
    const items = this.bot.inventory.items();
    if (items.length === 0) {
      logger.info("Inventory: empty");
      return;
    }

    const summary = items
      .map((item) => `${item.name}×${item.count}`)
      .join(", ");
    logger.info(`Inventory: ${summary}`);
  }
}
