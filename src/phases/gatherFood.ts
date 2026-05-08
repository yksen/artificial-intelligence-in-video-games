import type { Bot } from "mineflayer";
import type { Phase } from "./types.js";
import { logger } from "../logger.js";
import { FOOD_ANIMALS, RAW_FOOD_ITEMS, RESOURCE_TARGETS } from "../config.js";
import { equipBestWeapon } from "../utils/inventory.js";
import { getFoodCount } from "../utils/survival.js";
import { goToPosition, sleep, type Vec3Like } from "../utils/navigation.js";
import { smeltItems } from "../utils/smelting.js";

export const gatherFoodPhase: Phase = {
  name: "Gather Food",

  canSkip(bot: Bot): boolean {
    return getFoodCount(bot) >= RESOURCE_TARGETS.cookedFood;
  },

  async execute(bot: Bot): Promise<void> {
    logger.info("=== Phase 3: Gather Food ===");

    const targetFood = RESOURCE_TARGETS.cookedFood;
    let currentFood = getFoodCount(bot);

    if (currentFood >= targetFood) {
      logger.info("Already have enough food");
      return;
    }

    logger.info("Hunting animals for food");

    let rawMeatCount = bot.inventory.items().reduce((sum, item) => {
      return RAW_FOOD_ITEMS.includes(item.name as any) ? sum + item.count : sum;
    }, 0);

    let attempts = 0;
    const maxAttempts = 30;

    while (rawMeatCount + currentFood < targetFood && attempts < maxAttempts) {
      attempts++;

      const animal = bot.nearestEntity((entity) => {
        if (!entity || !entity.name) return false;
        return FOOD_ANIMALS.includes(entity.name as any);
      });

      if (!animal) {
        logger.warn("No animals found nearby, exploring...");
        const wanderTarget: Vec3Like = {
          x: bot.entity.position.x + (Math.random() - 0.5) * 40,
          y: bot.entity.position.y,
          z: bot.entity.position.z + (Math.random() - 0.5) * 40,
        };
        try {
          await goToPosition(bot, wanderTarget, 5);
        } catch {
        }
        await sleep(1000);
        continue;
      }

      try {
        await equipBestWeapon(bot);
        await goToPosition(bot, animal.position, 2);

        logger.info(`Attacking ${animal.name}`);
        let swings = 0;
        while (animal.isValid && swings < 15) {
          await bot.attack(animal);
          await sleep(500);
          swings++;
        }

        await sleep(500);

        await goToPosition(bot, animal.position, 1);
        await sleep(500);
      } catch (err) {
        logger.debug(`Failed to kill animal: ${err}`);
      }

      rawMeatCount = bot.inventory.items().reduce((sum, item) => {
        return RAW_FOOD_ITEMS.includes(item.name as any) ? sum + item.count : sum;
      }, 0);

      logger.debug(`Raw meat collected: ${rawMeatCount}`);
    }

    if (rawMeatCount > 0) {
      logger.info(`Cooking ${rawMeatCount} raw meat`);

      for (const rawName of RAW_FOOD_ITEMS) {
        const count = bot.inventory.items().reduce((sum, item) => {
          return item.name === rawName ? sum + item.count : sum;
        }, 0);
        if (count > 0) {
          try {
            const cookedName = getCookedName(rawName);
            logger.info(`Smelting ${count}x ${rawName} => ${cookedName}`);
            await smeltItems(bot, rawName, count);
          } catch (err) {
            logger.warn(`Failed to smelt ${rawName}: ${err}`);
          }
        }
      }
    }

    currentFood = getFoodCount(bot);
    logger.info(`Phase 3 complete: Have ${currentFood} cooked food items`);
  },
};

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
