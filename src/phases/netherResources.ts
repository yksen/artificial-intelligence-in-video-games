import type { Bot } from "mineflayer";
import type { Entity } from "prismarine-entity";
import type { Phase } from "./types.js";
import { logger } from "../logger.js";
import { RESOURCE_TARGETS } from "../config.js";
import { countItem, hasItem, findItem, equipBestArmor, equipBestWeapon } from "../utils/inventory.js";
import { findAndMineAnyBlock } from "../utils/mining.js";
import { craftItem } from "../utils/crafting.js";
import { goToPosition, findBlockByNames, sleep, type Vec3Like } from "../utils/navigation.js";
import { killEntity, getNearestByNames, raiseShield, lowerShield } from "../utils/combat.js";
import { eatFood, getFoodCount } from "../utils/survival.js";

const FORTRESS_BLOCKS = ["nether_bricks", "nether_brick_fence", "nether_brick_stairs"] as const;
const NETHER_GOLD_BLOCKS = ["nether_gold_ore", "gilded_blackstone"] as const;

export const netherResourcesPhase: Phase = {
  name: "Nether Resources",

  canSkip(bot: Bot): boolean {
    if (countItem(bot, "ender_eye") >= 12) return true;
    const rods = countItem(bot, "blaze_rod");
    const powder = countItem(bot, "blaze_powder");
    const pearls = countItem(bot, "ender_pearl");
    return rods * 2 + powder >= 12 && pearls >= 12;
  },

  async execute(bot: Bot): Promise<void> {
    logger.info("=== Phase 7: Nether Resources ===");

    if ((bot.game as any).dimension !== "the_nether") {
      throw new Error("Not in the Nether — cannot run the nether resource phase");
    }

    if (!(bot as any).__netherHome) {
      const portal = findBlockByNames(bot, ["nether_portal"], 16);
      const here = portal ? portal.position : bot.entity.position;
      (bot as any).__netherHome = { x: here.x, y: here.y, z: here.z };
      logger.info(`Recorded nether home portal at ${Math.round(here.x)},${Math.round(here.y)},${Math.round(here.z)}`);
    }

    await safeEquip(bot);

    if (!haveEnoughBlaze(bot)) {
      await gatherBlazeRods(bot);
    }

    if (countItem(bot, "ender_pearl") < RESOURCE_TARGETS.enderPearls) {
      await gatherEnderPearls(bot);
    }

    const rods = countItem(bot, "blaze_rod");
    const pearls = countItem(bot, "ender_pearl");
    logger.info(`Nether resources status: ${rods} blaze rods, ${pearls} ender pearls`);

    if (!haveEnoughBlaze(bot)) {
      throw new Error(`Not enough blaze rods (have ${rods}); need materials for 12 eyes`);
    }
    if (pearls < 12) {
      throw new Error(`Not enough ender pearls (have ${pearls}); need 12+`);
    }

    logger.info("Phase 7 complete: blaze rods and ender pearls secured");
  },
};

function blazeValue(bot: Bot): number {
  return countItem(bot, "blaze_rod") * 2 + countItem(bot, "blaze_powder");
}

function haveEnoughBlaze(bot: Bot): boolean {
  return blazeValue(bot) >= 12;
}

async function safeEquip(bot: Bot): Promise<void> {
  try {
    await equipBestArmor(bot);
  } catch {
  }
  try {
    await equipBestWeapon(bot);
  } catch {
  }
}

async function topUpFood(bot: Bot): Promise<void> {
  if (getFoodCount(bot) > 0 && bot.food < 18) {
    try {
      await eatFood(bot);
    } catch {
    }
  }
}

export async function gatherBlazeRods(bot: Bot, targetBlazeValue: number = 12): Promise<void> {
  logger.info(`Searching for a nether fortress / blazes (target blaze value ${targetBlazeValue})`);
  const maxLegs = 24;

  for (let leg = 0; leg < maxLegs && blazeValue(bot) < targetBlazeValue; leg++) {
    await topUpFood(bot);
    await raiseShield(bot);

    const blaze = getNearestByNames(bot, ["blaze"], 24);
    if (blaze) {
      logger.info(`Engaging blaze (have ${countItem(bot, "blaze_rod")} rods)`);
      await fightBlaze(bot, blaze);
      await collectDropsAround(bot);
      continue;
    }

    const gold = findBlockByNames(bot, NETHER_GOLD_BLOCKS, 16);
    if (gold) {
      try {
        await findAndMineAnyBlock(bot, NETHER_GOLD_BLOCKS, 4, 16);
      } catch {
      }
    }

    const fortress = findBlockByNames(bot, FORTRESS_BLOCKS, 48);
    const target: Vec3Like = fortress
      ? { x: fortress.position.x, y: fortress.position.y, z: fortress.position.z }
      : explorationTarget(bot, leg);

    try {
      await goToPosition(bot, target, fortress ? 3 : 6);
    } catch (err) {
      logger.debug(`Exploration leg ${leg} goto failed: ${err}`);
    }
    await sleep(300);
  }

  lowerShield(bot);
  if (blazeValue(bot) < targetBlazeValue) {
    logger.warn(`Gave up blaze hunt with ${countItem(bot, "blaze_rod")} rods`);
  }
}

async function fightBlaze(bot: Bot, blaze: Entity): Promise<void> {
  const killed = await killEntity(bot, blaze, { timeoutMs: 15_000, minHealth: 8, reachApproach: 2, useShield: true });
  if (!killed) {
    lowerShield(bot);

    try {
      const away = bot.entity.position.minus(blaze.position).normalize().scaled(6);
      await goToPosition(bot, bot.entity.position.plus(away), 2);
    } catch {
    }
    await topUpFood(bot);
  }
}

async function gatherEnderPearls(bot: Bot): Promise<void> {
  logger.info(`Gathering ender pearls (have ${countItem(bot, "ender_pearl")})`);

  await craftNuggetsIntoIngots(bot);
  if (countItem(bot, "ender_pearl") < RESOURCE_TARGETS.enderPearls && !hasItem(bot, "gold_ingot")) {
    await gatherGold(bot);
  }

  if (countItem(bot, "ender_pearl") < RESOURCE_TARGETS.enderPearls && hasItem(bot, "gold_ingot")) {
    await barterForPearls(bot);
  }

  if (countItem(bot, "ender_pearl") < RESOURCE_TARGETS.enderPearls) {
    await huntEndermenForPearls(bot);
  }
}

export async function gatherGold(bot: Bot, target: number = RESOURCE_TARGETS.goldForBarter): Promise<void> {
  const ingotEquivalent = () => countItem(bot, "gold_ingot") + Math.floor(countItem(bot, "gold_nugget") / 9);
  logger.info(
    `Gathering gold for bartering (have ${countItem(bot, "gold_ingot")} ingots + ${countItem(bot, "gold_nugget")} nuggets)`,
  );

  const maxLegs = 24;
  for (let leg = 0; leg < maxLegs && ingotEquivalent() < target; leg++) {
    await topUpFood(bot);

    const ore = findBlockByNames(bot, NETHER_GOLD_BLOCKS, 16);
    if (ore) {
      try {
        await findAndMineAnyBlock(bot, NETHER_GOLD_BLOCKS, 6, 16);
      } catch (err) {
        logger.debug(`Gold mining leg ${leg} failed: ${err}`);
      }
      await collectDropsAround(bot, 8);
    } else {
      try {
        await goToPosition(bot, explorationTarget(bot, leg), 6);
      } catch {
      }
      await sleep(300);
    }
  }

  await craftNuggetsIntoIngots(bot);
  logger.info(`Gold gathering done: ${countItem(bot, "gold_ingot")} ingots`);
}

async function craftNuggetsIntoIngots(bot: Bot): Promise<void> {
  const makeable = Math.floor(countItem(bot, "gold_nugget") / 9);
  if (makeable <= 0) return;
  try {
    await craftItem(bot, "gold_ingot", makeable);
  } catch (err) {
    logger.debug(`Crafting nuggets into ingots failed: ${err}`);
  }
}

const GOLD_ARMOR: { dest: "feet" | "legs" | "head" | "torso"; item: string }[] = [
  { dest: "feet", item: "golden_boots" },
  { dest: "head", item: "golden_helmet" },
  { dest: "legs", item: "golden_leggings" },
  { dest: "torso", item: "golden_chestplate" },
];

async function equipGoldArmorForBartering(bot: Bot): Promise<boolean> {
  let equipped = false;
  for (const slot of GOLD_ARMOR) {
    const item = findItem(bot, slot.item);
    if (item) {
      try {
        await bot.equip(item, slot.dest);
        equipped = true;
      } catch {
      }
    }
  }
  return equipped;
}

function nearbyPiglins(bot: Bot, range: number): Entity[] {
  return Object.values(bot.entities)
    .filter((e) => e && e.name === "piglin" && (e as any).isValid !== false)
    .filter((e) => e.position.distanceTo(bot.entity.position) <= range)
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
}

export async function barterForPearls(
  bot: Bot,
  opts: { target?: number; maxCycles?: number } = {},
): Promise<void> {
  const target = opts.target ?? RESOURCE_TARGETS.enderPearls;
  const maxCycles = opts.maxCycles ?? 60;

  await equipGoldArmorForBartering(bot);
  logger.info(
    `Bartering for pearls (have ${countItem(bot, "ender_pearl")} pearls, ${countItem(bot, "gold_ingot")} gold)`,
  );

  for (let cycle = 0; cycle < maxCycles; cycle++) {
    if (countItem(bot, "ender_pearl") >= target) break;
    if (!hasItem(bot, "gold_ingot")) break;
    await topUpFood(bot);

    const piglins = nearbyPiglins(bot, 16);
    if (piglins.length === 0) {
      try {
        await goToPosition(bot, explorationTarget(bot, cycle), 6);
      } catch {
      }
      await sleep(300);
      continue;
    }

    const pearlsBefore = countItem(bot, "ender_pearl");
    const goldBefore = countItem(bot, "gold_ingot");
    let tossed = 0;
    for (const piglin of piglins) {
      if (!hasItem(bot, "gold_ingot") || tossed >= 16) break;
      try {
        await goToPosition(bot, piglin.position, 2, 5000);
        const gold = findItem(bot, "gold_ingot");
        if (!gold) break;
        await bot.equip(gold, "hand");
        await bot.lookAt(piglin.position.offset(0, 1, 0), true);
        await bot.toss(gold.type, null, 1);
        tossed++;
      } catch (err) {
        logger.debug(`Barter toss failed: ${err}`);
      }
      await sleep(150);
    }

    await sleep(7500);
    await collectDropsAround(bot, 12);
    logger.info(
      `Barter cycle ${cycle}: ${piglins.length} piglins, tossed ${tossed}, ` +
        `pearls ${pearlsBefore}→${countItem(bot, "ender_pearl")}, gold ${goldBefore}→${countItem(bot, "gold_ingot")}`,
    );
  }

  logger.info(
    `Bartering done: ${countItem(bot, "ender_pearl")} pearls, ${countItem(bot, "gold_ingot")} gold left`,
  );
}

async function huntEndermenForPearls(bot: Bot): Promise<void> {
  logger.info(`Hunting endermen for pearls (have ${countItem(bot, "ender_pearl")})`);
  const maxLegs = 30;

  for (let leg = 0; leg < maxLegs && countItem(bot, "ender_pearl") < RESOURCE_TARGETS.enderPearls; leg++) {
    await topUpFood(bot);

    const enderman = getNearestByNames(bot, ["enderman"], 28);
    if (enderman) {
      logger.info("Engaging enderman for pearls");
      await killEntity(bot, enderman, { timeoutMs: 15_000, minHealth: 8, reachApproach: 2 });
      await collectDropsAround(bot);
      continue;
    }

    try {
      await goToPosition(bot, explorationTarget(bot, leg), 6);
    } catch {
    }
    await sleep(300);
  }
}

async function collectDropsAround(bot: Bot, maxPickups: number = 3): Promise<void> {
  await sleep(600);
  const deadline = Date.now() + 9_000;
  for (let i = 0; i < maxPickups && Date.now() < deadline; i++) {
    const drop = bot.nearestEntity((e) => (e as any)?.name === "item");
    if (!drop) break;
    if (drop.position.distanceTo(bot.entity.position) > 16) break;
    try {
      await goToPosition(bot, drop.position, 1, 3500);
    } catch {
      break;
    }
    await sleep(250);
  }
}

function explorationTarget(bot: Bot, leg: number): Vec3Like {
  const angle = leg * 2.39996;
  const radius = 20 + leg * 6;
  return {
    x: bot.entity.position.x + Math.cos(angle) * radius,
    y: bot.entity.position.y,
    z: bot.entity.position.z + Math.sin(angle) * radius,
  };
}
