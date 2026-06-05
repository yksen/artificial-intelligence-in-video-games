import mineflayer from "mineflayer";
import { pathfinder } from "mineflayer-pathfinder";
import { plugin as collectBlock } from "mineflayer-collectblock";
import { plugin as pvp } from "mineflayer-pvp";
import { plugin as tool } from "mineflayer-tool";
import { logger } from "./logger.js";
import { BOT_CONFIG } from "./config.js";
import type { Phase } from "./types.js";
import type { PhaseContext } from "./runtime.js";
import { bindSession, loadMcData, beginReflex, endReflex } from "./runtime.js";
import { botEvents } from "./events.js";
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

type RunState = "idle" | "running" | "retrying" | "halted" | "done";

const SURFACE_PHASE_CUTOFF = 4;

export class MinecraftBot {
  private readonly bot: mineflayer.Bot;
  private readonly phases: Phase[];
  private readonly maxPhaseAttempts = 3;

  private state: RunState = "idle";
  private run: AbortController | null = null;
  private spawnCount = 0;
  private disposed = false;
  private reflexBusy = false;
  private readonly phaseAttempts = new Map<number, number>();
  private readonly milestonesSeen = new Set<string>();

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
      } else {
        logger.info("Respawned! Re-assessing inventory and determining restart phase...");
      }
      void this.beginRun();
    });

    this.bot.on("death", () => {
      logger.error("Bot died!");
      this.run?.abort();
      try {
        this.bot.pathfinder.stop();
      } catch {
      }
    });

    this.bot.on("health", () => void this.handleSurvivalInterrupt());
    this.bot.on("kicked", (reason) => logger.error(`Bot was kicked: ${reason}`));
    this.bot.on("error", (err) => logger.error(`Bot error: ${err.message}`));
    this.bot.on("end", (reason) => {
      logger.info(`Bot disconnected: ${reason}`);
      this.run?.abort();
    });
  }

  private async beginRun(): Promise<void> {
    if (this.disposed) return;

    this.run?.abort();
    const run = new AbortController();
    this.run = run;
    bindSession(this.bot, run.signal);
    this.state = "running";

    await this.waitForInventoryReady();
    if (this.isStale(run)) return;

    if (this.bot.game.dimension === "the_end") {
      logger.info("Already in the End! Goal achieved.");
      this.state = "done";
      return;
    }

    await this.preamble(run);
    if (this.isStale(run)) return;

    await this.runPhases(run);

    if (!this.isStale(run) && this.state === "running") {
      this.state = "done";
      logger.info("=== All phases completed! ===");
    }
  }

  private async preamble(run: AbortController): Promise<void> {
    try {
      await equipBestArmor(this.bot);
    } catch {
    }
    try {
      await lootNearbyChests(this.bot, 16);
    } catch {
    }
    if (this.isStale(run)) return;

    const firstNeeded = this.firstNeededPhase(run.signal);
    const currentY = Math.floor(this.bot.entity.position.y);
    if (firstNeeded >= 0 && firstNeeded < SURFACE_PHASE_CUTOFF && currentY < 50) {
      logger.info(`Underground at Y=${currentY} but need surface phases, navigating up...`);
      try {
        await goToY(this.bot, 64);
        logger.info(`Reached surface at Y=${Math.floor(this.bot.entity.position.y)}`);
      } catch (err) {
        logger.warn(`Failed to reach surface: ${err}`);
      }
    }
  }

  private async runPhases(run: AbortController): Promise<void> {
    for (let i = 0; i < this.phases.length; i++) {
      if (this.isStale(run)) return;
      const phase = this.phases[i]!;
      if (phase.canSkip(this.contextFor(phase, run.signal))) {
        logger.info(`Skipping phase: ${phase.name} (already completed)`);
        continue;
      }
      const completed = await this.attemptPhase(i, run);
      if (!completed) return;
    }
  }

  private async attemptPhase(index: number, run: AbortController): Promise<boolean> {
    const phase = this.phases[index]!;
    botEvents.emit("phase:start", { phase: phase.name, index, total: this.phases.length });
    logger.info(`Starting phase ${index + 1}/${this.phases.length}: ${phase.name}`);

    for (;;) {
      this.state = "running";
      try {
        await phase.execute(this.contextFor(phase, run.signal));
        if (this.isStale(run)) return false;
        logger.info(`Phase "${phase.name}" completed successfully`);
        botEvents.emit("phase:complete", { phase: phase.name, index, total: this.phases.length });
        this.phaseAttempts.delete(index);
        await this.afterPhase(run);
        return true;
      } catch (err) {
        if (this.isStale(run)) return false;
        const attempts = (this.phaseAttempts.get(index) ?? 0) + 1;
        this.phaseAttempts.set(index, attempts);
        botEvents.emit("phase:fail", { phase: phase.name, index, total: this.phases.length, error: String(err) });
        logger.error(`Phase "${phase.name}" failed (attempt ${attempts}/${this.maxPhaseAttempts}): ${err}`);

        if (attempts >= this.maxPhaseAttempts) {
          logger.error(`Phase "${phase.name}" exhausted attempts — halting; supervisor will take over`);
          this.state = "halted";
          return false;
        }

        this.state = "retrying";
        await sleep(attempts === 1 ? 3000 : 10000);
        if (this.isStale(run)) return false;
      }
    }
  }

  private async afterPhase(run: AbortController): Promise<void> {
    try {
      await freeInventory(this.bot);
      if (shouldEat(this.bot)) await eatFood(this.bot);
      await equipBestArmor(this.bot);
    } catch {
    }
    if (this.isStale(run)) return;
    this.noteMilestone();
    this.logInventorySummary();
  }

  private noteMilestone(): void {
    const dim = this.bot.game.dimension;
    if ((dim === "the_nether" || dim === "the_end") && !this.milestonesSeen.has(dim)) {
      this.milestonesSeen.add(dim);
      const name = dim === "the_end" ? "Reached the End" : "Entered the Nether";
      logger.info(`=== Milestone: ${name} ===`);
      botEvents.emit("milestone", { name, dimension: dim });
    }
  }

  private firstNeededPhase(signal: AbortSignal): number {
    return this.phases.findIndex((p) => !p.canSkip(this.contextFor(p, signal)));
  }

  private contextFor(phase: Phase, signal: AbortSignal): PhaseContext {
    return {
      bot: this.bot,
      mcData: loadMcData(this.bot),
      signal,
      events: botEvents,
      log: logger.scoped(phase.name),
    };
  }

  private isStale(run: AbortController): boolean {
    return run.signal.aborted || this.run !== run;
  }

  private async handleSurvivalInterrupt(): Promise<void> {
    if (this.reflexBusy || this.disposed) return;

    const reflex = this.selectReflex();
    if (!reflex) return;

    this.reflexBusy = true;
    beginReflex(this.bot);
    try {
      this.bot.pathfinder.stop();
    } catch {
    }
    try {
      await reflex.run();
    } catch (err) {
      logger.warn(`Survival reflex "${reflex.name}" failed: ${err}`);
    } finally {
      endReflex(this.bot);
      this.reflexBusy = false;
    }
  }

  private selectReflex(): { name: string; run: () => Promise<void> } | null {
    if (isInLavaOrFire(this.bot)) {
      return { name: "escape-lava", run: () => escapeLavaOrFire(this.bot) };
    }
    if (isDrowning(this.bot)) {
      return {
        name: "escape-water",
        run: async () => {
          logger.warn(`Drowning interrupt: oxygen=${(this.bot as any).oxygenLevel ?? "?"}`);
          await escapeWater(this.bot);
        },
      };
    }
    if (shouldEat(this.bot)) {
      return {
        name: "eat",
        run: async () => {
          logger.info(`Hunger interrupt: food=${this.bot.food}/20`);
          await eatFood(this.bot);
        },
      };
    }
    if (shouldFlee(this.bot)) {
      const hostiles = getNearbyHostiles(this.bot, 8);
      if (hostiles.length > 0) {
        return {
          name: "flee",
          run: async () => {
            logger.warn(`Danger! Health=${this.bot.health}/20, ${hostiles.length} hostile(s) nearby`);
            await flee(this.bot, hostiles[0]!);
            await eatFood(this.bot);
          },
        };
      }
    }
    return null;
  }

  private async waitForInventoryReady(maxWaitMs = 3000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (this.bot.inventory.items().length > 0) return;
      await sleep(200);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.state = "idle";
    this.run?.abort();
    try {
      this.bot.pathfinder?.stop?.();
    } catch {
    }
    try {
      this.bot.removeAllListeners();
    } catch {
    }
    try {
      this.bot.quit("harness: retiring instance");
    } catch {
    }
  }

  private logInventorySummary(): void {
    const items = this.bot.inventory.items();
    if (items.length === 0) {
      logger.info("Inventory: empty");
      return;
    }
    logger.info(`Inventory: ${items.map((item) => `${item.name}×${item.count}`).join(", ")}`);
  }
}
