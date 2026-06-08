import type { Bot } from "mineflayer";
import type { LogWriter } from "../logger.js";
import { definePhase } from "../step.js";
import { FOOD_ANIMALS, RAW_FOOD_ITEMS, RESOURCE_TARGETS } from "../config.js";
import { getFoodCount } from "../utils/survival.js";
import { killEntity } from "../utils/combat.js";
import { goToPosition, sleep, type Vec3Like } from "../utils/navigation.js";
import { smeltItems } from "../utils/smelting.js";

const rawMeat = (bot: Bot): number =>
  bot.inventory.items().reduce((sum, item) => (RAW_FOOD_ITEMS.includes(item.name as any) ? sum + item.count : sum), 0);

export const gatherFoodPhase = definePhase({
  name: "Gather Food",

  canSkip: ({ bot }) => getFoodCount(bot) >= RESOURCE_TARGETS.cookedFood,

  steps: () => [
    {
      name: "Hunt animals for raw meat",
      isDone: ({ bot }) => rawMeat(bot) + getFoodCount(bot) >= RESOURCE_TARGETS.cookedFood,
      run: ({ bot, log }) => huntForMeat(bot, log),
    },
    {
      name: "Cook raw meat",
      isDone: ({ bot }) => rawMeat(bot) === 0 || getFoodCount(bot) >= RESOURCE_TARGETS.cookedFood,
      run: ({ bot, log }) => cookMeat(bot, log),
    },
  ],
});

async function huntForMeat(bot: Bot, log: LogWriter): Promise<void> {
  const targetFood = RESOURCE_TARGETS.cookedFood;
  const currentFood = getFoodCount(bot);
  let rawMeatCount = rawMeat(bot);

  let attempts = 0;
  const maxAttempts = 40;
  const failed = new Set<number>();
  let dryStreak = 0;

  const tier = (name: string): number => {
    if (name === "cow" || name === "pig" || name === "sheep") return 0;
    if (name === "chicken") return 1;
    return 2;
  };
  const pickAnimal = (): typeof bot.entities[number] | null => {
    let best: any = null;
    let bestKey = Infinity;
    for (const e of Object.values(bot.entities)) {
      if (!e || !e.name || e === bot.entity) continue;
      if (!FOOD_ANIMALS.includes(e.name as any)) continue;
      if ((e as any).isValid === false) continue;
      if (failed.has(e.id)) continue;
      const dist = e.position.distanceTo(bot.entity.position);
      if (dist > 48) continue;
      const key = tier(e.name) * 1000 + dist;
      if (key < bestKey) {
        bestKey = key;
        best = e;
      }
    }
    return best;
  };

  const wander = async (): Promise<void> => {
    const target: Vec3Like = {
      x: bot.entity.position.x + (Math.random() - 0.5) * 60,
      y: bot.entity.position.y,
      z: bot.entity.position.z + (Math.random() - 0.5) * 60,
    };
    try {
      await goToPosition(bot, target, 5);
    } catch {
    }
  };

  while (rawMeatCount + currentFood < targetFood && attempts < maxAttempts) {
    attempts++;
    const animal = pickAnimal();

    if (!animal) {
      log.warn("No (catchable) animals nearby, exploring...");
      failed.clear();
      await wander();
      await sleep(800);
      continue;
    }

    const animalId = animal.id;
    try {
      const where = animal.position.clone();
      log.info(`Attacking ${animal.name} (${Math.round(where.distanceTo(bot.entity.position))}m)`);
      const killed = await killEntity(bot, animal, { timeoutMs: 15_000, minHealth: 0 });
      if (!killed) failed.add(animalId);

      await sleep(400);
      try {
        await goToPosition(bot, where, 0);
      } catch {
      }
      await sleep(400);
    } catch (err) {
      failed.add(animalId);
      log.debug(`Failed to kill animal: ${err}`);
    }

    const prev = rawMeatCount;
    rawMeatCount = rawMeat(bot);
    dryStreak = rawMeatCount > prev ? 0 : dryStreak + 1;
    if (dryStreak >= 4) {
      dryStreak = 0;
      failed.clear();
      await wander();
    }
  }
}

async function cookMeat(bot: Bot, log: LogWriter): Promise<void> {
  for (const rawName of RAW_FOOD_ITEMS) {
    const count = bot.inventory.items().reduce((sum, item) => (item.name === rawName ? sum + item.count : sum), 0);
    if (count === 0) continue;
    try {
      log.info(`Smelting ${count}x ${rawName} => ${getCookedName(rawName)}`);
      await smeltItems(bot, rawName, count);
    } catch (err) {
      log.warn(`Failed to smelt ${rawName}: ${err}`);
    }
  }
  log.info(`Have ${getFoodCount(bot)} cooked food items`);
}

function getCookedName(rawName: string): string {
  const cookingMap: Record<string, string> = {
    beef: "cooked_beef",
    porkchop: "cooked_porkchop",
    mutton: "cooked_mutton",
    chicken: "cooked_chicken",
    cod: "cooked_cod",
    salmon: "cooked_salmon",
    potato: "baked_potato",
  };
  return cookingMap[rawName] ?? rawName;
}
