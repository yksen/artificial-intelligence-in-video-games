import type { Bot } from "mineflayer";
import { definePhase } from "../step.js";
import { RESOURCE_TARGETS } from "../config.js";
import { countItem, hasItem, hasPickaxeTier, craftAndEquipArmor } from "../utils/inventory.js";
import { findAndMineBlocks, findAndMineAnyBlock, digDownTo } from "../utils/mining.js";
import { craftItem, ensureItem } from "../utils/crafting.js";
import { smeltItems } from "../utils/smelting.js";
import { sleep } from "../utils/navigation.js";

const hasAnyBucket = (bot: Bot): boolean =>
  hasItem(bot, "bucket") || hasItem(bot, "water_bucket") || hasItem(bot, "lava_bucket");

export const ironAgePhase = definePhase({
  name: "Iron Age",

  canSkip: ({ bot }) => hasPickaxeTier(bot, "iron") && hasAnyBucket(bot),

  steps: () => [
    {
      name: "Mine iron ore",
      isDone: ({ bot }) => countItem(bot, "iron_ingot") + countItem(bot, "iron_ore") >= RESOURCE_TARGETS.ironIngots,
      run: async ({ bot, log }) => {
        const have = countItem(bot, "iron_ingot") + countItem(bot, "iron_ore");
        const neededOre = RESOURCE_TARGETS.ironIngots - have;
        const mined = await findAndMineBlocks(bot, "iron_ore", neededOre);
        log.info(`Mined ${mined} iron ore`);
        if (mined === 0) {
          log.info("No surface iron found, mining underground...");
          await digDownTo(bot, 32);
          const deep = await findAndMineBlocks(bot, "iron_ore", neededOre, 32);
          log.info(`Mined ${deep} iron ore underground`);
        }
      },
    },
    {
      name: "Collect coal for fuel",
      isDone: ({ bot }) => countItem(bot, "coal") >= 8,
      run: ({ bot }) => findAndMineBlocks(bot, "coal_ore", 8 - countItem(bot, "coal")).then(() => undefined),
    },
    {
      name: "Smelt iron ore",
      isDone: ({ bot }) => countItem(bot, "iron_ore") === 0,
      run: ({ bot }) => smeltItems(bot, "iron_ore", countItem(bot, "iron_ore")),
    },
    {
      name: "Ensure sticks",
      isDone: ({ bot }) => countItem(bot, "stick") >= 4,
      run: ({ bot }) => ensureItem(bot, "stick", 8),
    },
    {
      name: "Craft iron pickaxe",
      isDone: ({ bot }) => hasPickaxeTier(bot, "iron"),
      run: ({ bot }) => craftItem(bot, "iron_pickaxe", 1),
    },
    {
      name: "Craft iron sword",
      isDone: ({ bot }) => hasItem(bot, "iron_sword") || hasItem(bot, "diamond_sword"),
      run: async ({ bot, log }) => {
        try {
          await craftItem(bot, "iron_sword", 1);
        } catch {
          log.warn("Couldn't craft iron sword (not enough iron)");
        }
      },
    },
    {
      name: "Craft bucket",
      isDone: ({ bot }) => hasAnyBucket(bot),
      run: ({ bot }) => craftItem(bot, "bucket", 1),
    },
    {
      name: "Craft and equip armor",
      run: async ({ bot, log }) => {
        try {
          await craftAndEquipArmor(bot, 1);
        } catch (err) {
          log.debug(`Armor step skipped: ${err}`);
        }
      },
    },
    {
      name: "Gather flint from gravel",
      isDone: ({ bot }) => hasItem(bot, "flint") || hasItem(bot, "flint_and_steel"),
      run: async ({ bot, log }) => {
        let emptyRounds = 0;
        let totalGravel = 0;
        while (!hasItem(bot, "flint") && emptyRounds < 4 && totalGravel < 64) {
          const mined = await findAndMineAnyBlock(bot, ["gravel"], 8, 40);
          totalGravel += mined;
          emptyRounds = mined === 0 ? emptyRounds + 1 : 0;
          await sleep(200);
        }
        if (!hasItem(bot, "flint")) log.warn(`Could not obtain flint from gravel (mined ${totalGravel})`);
      },
    },
    {
      name: "Craft flint and steel",
      isDone: ({ bot }) => hasItem(bot, "flint_and_steel") || !hasItem(bot, "flint"),
      run: ({ bot }) => craftItem(bot, "flint_and_steel", 1),
    },
  ],
});
