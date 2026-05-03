import { createRequire } from 'node:module'
import { loader as autoEat } from 'mineflayer-auto-eat'
import { config } from './config.js'

const require = createRequire(import.meta.url)
const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const collectBlockPlugin = require('mineflayer-collectblock').plugin
const pvpPlugin = require('mineflayer-pvp').plugin
const { Vec3 } = require('vec3')

const { GoalNear } = goals

const WOOD_TYPES = [
  ['oak_log', 'oak_planks'],
  ['birch_log', 'birch_planks'],
  ['spruce_log', 'spruce_planks'],
  ['jungle_log', 'jungle_planks'],
  ['acacia_log', 'acacia_planks'],
  ['dark_oak_log', 'dark_oak_planks'],
  ['mangrove_log', 'mangrove_planks'],
  ['cherry_log', 'cherry_planks'],
  ['crimson_stem', 'crimson_planks'],
  ['warped_stem', 'warped_planks']
]

const LOG_NAMES = WOOD_TYPES.map(([log]) => log)
const PLANK_NAMES = WOOD_TYPES.map(([, planks]) => planks)
const STONE_NAMES = ['stone', 'cobblestone']
const IRON_ORE_NAMES = ['iron_ore', 'deepslate_iron_ore']
const FUEL_NAMES = ['coal', 'charcoal', ...LOG_NAMES, ...PLANK_NAMES]
const FOOD_MOBS = new Set(['cow', 'pig', 'chicken', 'sheep', 'rabbit'])
const HOSTILE_MOBS = new Set([
  'zombie',
  'skeleton',
  'spider',
  'creeper',
  'witch',
  'drowned',
  'husk',
  'stray',
  'slime',
  'phantom'
])

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const bot = mineflayer.createBot({
  host: config.host,
  port: config.port,
  username: config.username,
  auth: config.auth,
  version: config.version
})

let runningMilestone = false

bot.loadPlugin(pathfinder)
bot.loadPlugin(collectBlockPlugin)
bot.loadPlugin(pvpPlugin)

bot.once('spawn', () => {
  configurePathfinding()
  configureAutoEat()
  registerDefenseLoop()

  console.log(`Connected as ${bot.username} on ${config.host}:${config.port}`)
  if (config.autoStart) {
    runMilestoneOne().catch(handleFatalTaskError)
  } else {
    console.log('Milestone auto-start disabled. Use chat command "start" to begin.')
  }
})

bot.on('chat', (username, message) => {
  if (username === bot.username) return

  const command = message.trim().toLowerCase()
  if (command === 'start') {
    runMilestoneOne().catch(handleFatalTaskError)
  }

  if (command === 'stop') {
    runningMilestone = false
    bot.collectBlock.cancelTask().catch(() => {})
    bot.pathfinder.setGoal(null)
    bot.pvp.stop().catch(() => {})
    bot.chat('Stopping current milestone task.')
  }

  if (command === 'status') {
    bot.chat(getInventorySummary())
  }

  if (command === 'come') {
    const target = bot.players[username]?.entity
    if (!target) {
      bot.chat("I can't see you.")
      return
    }

    const { x, y, z } = target.position
    bot.pathfinder.setGoal(new GoalNear(x, y, z, 1))
  }
})

bot.on('error', err => console.error('Bot error:', err))
bot.on('kicked', reason => console.error('Bot kicked:', reason))
bot.on('end', () => console.log('Disconnected from server.'))

function configurePathfinding () {
  const movements = new Movements(bot)
  movements.canDig = true
  movements.allow1by1towers = true
  movements.allowParkour = false

  for (const name of ['dirt', 'cobblestone', ...PLANK_NAMES]) {
    const item = bot.registry.itemsByName[name]
    if (item && !movements.scafoldingBlocks.includes(item.id)) {
      movements.scafoldingBlocks.push(item.id)
    }
  }

  bot.pathfinder.thinkTimeout = 10000
  bot.pathfinder.searchRadius = config.collectionRadius
  bot.pathfinder.setMovements(movements)
  bot.collectBlock.movements = movements
}

function configureAutoEat () {
  bot.loadPlugin(autoEat)
  bot.autoEat.setOpts({
    priority: 'foodPoints',
    minHunger: 16,
    minHealth: 14,
    bannedFood: ['rotten_flesh', 'pufferfish', 'chorus_fruit', 'poisonous_potato', 'spider_eye']
  })
  bot.autoEat.enableAuto()
}

function registerDefenseLoop () {
  bot.on('physicsTick', () => {
    const threat = nearestEntity(entity => {
      return entity.type === 'mob' &&
        HOSTILE_MOBS.has(entity.name) &&
        entity.position.distanceTo(bot.entity.position) <= 6
    })

    if (!threat) return
    equipBestWeapon().catch(() => {})
    bot.pvp.attack(threat).catch(() => {})
  })
}

async function runMilestoneOne () {
  if (runningMilestone) {
    bot.chat('Milestone 1 is already running.')
    return
  }

  runningMilestone = true
  console.log('Starting Milestone 1: Foundation & Resource Independence.')

  try {
    await ensureLogs()
    await craftWoodBasics()
    await craftUntilAtLeast('wooden_pickaxe', 1, true)

    await collectUntilItemCount({
      blockNames: STONE_NAMES,
      itemNames: ['cobblestone'],
      targetCount: config.targets.cobblestone,
      label: 'cobblestone'
    })

    await craftUntilAtLeast('stone_pickaxe', 1, true)
    await craftUntilAtLeast('stone_sword', 1, true)
    await equipBestWeapon()
    await huntFoodIfNeeded()

    await collectUntilItemCount({
      blockNames: IRON_ORE_NAMES,
      itemNames: ['raw_iron', 'iron_ore', 'deepslate_iron_ore'],
      targetCount: config.targets.rawIron,
      label: 'iron ore'
    })

    await smeltIron()
    await craftOptionalIronGear()
    await equipArmor()

    const readiness = getNetherReadiness()
    console.log(readiness)
    bot.chat(readiness)
  } finally {
    runningMilestone = false
  }
}

async function ensureLogs () {
  await collectUntilItemCount({
    blockNames: LOG_NAMES,
    itemNames: LOG_NAMES,
    targetCount: config.targets.logs,
    label: 'logs'
  })
}

async function craftWoodBasics () {
  await craftPlanksUntilAtLeast(24)
  await craftUntilAtLeast('stick', 8, false)
  await craftUntilAtLeast('crafting_table', 1, false)
}

async function craftPlanksUntilAtLeast (targetCount) {
  while (countItems(PLANK_NAMES) < targetCount) {
    const wood = WOOD_TYPES.find(([log]) => countItems([log]) > 0)
    if (!wood) throw new Error('No logs available to craft planks.')
    await craftItem(wood[1], 1, false)
  }
}

async function collectUntilItemCount ({ blockNames, itemNames, targetCount, label }) {
  while (runningMilestone && countItems(itemNames) < targetCount) {
    await waitForCombatToFinish()

    const missing = targetCount - countItems(itemNames)
    const blocks = findBlocks(blockNames, Math.min(missing, 8))
    if (blocks.length === 0) {
      throw new Error(`Could not find nearby ${label}; move the bot closer to resources or increase COLLECTION_RADIUS.`)
    }

    console.log(`Collecting ${blocks.length} ${label} block(s).`)
    await bot.collectBlock.collect(blocks, { ignoreNoPath: true })
  }
}

function findBlocks (names, count) {
  const ids = names
    .map(name => bot.registry.blocksByName[name]?.id)
    .filter(id => id !== undefined)

  if (ids.length === 0) return []

  return bot.findBlocks({
    matching: ids,
    maxDistance: config.collectionRadius,
    count
  }).map(position => bot.blockAt(position)).filter(Boolean)
}

async function craftUntilAtLeast (itemName, targetCount, useCraftingTable) {
  while (countItems([itemName]) < targetCount) {
    await craftItem(itemName, 1, useCraftingTable)
  }
}

async function craftItem (itemName, times, useCraftingTable) {
  const item = bot.registry.itemsByName[itemName]
  if (!item) throw new Error(`Unknown item: ${itemName}`)

  const craftingTable = useCraftingTable ? await findOrPlaceBlock('crafting_table') : null
  const recipe = bot.recipesFor(item.id, null, 1, craftingTable)[0]
  if (!recipe) throw new Error(`No available recipe for ${itemName}.`)

  console.log(`Crafting ${itemName}.`)
  await bot.craft(recipe, times, craftingTable)
}

async function craftIfPossible (itemName, useCraftingTable) {
  try {
    await craftUntilAtLeast(itemName, 1, useCraftingTable)
    return true
  } catch (err) {
    console.log(`Skipping ${itemName}: ${err.message}`)
    return false
  }
}

async function findOrPlaceBlock (blockName) {
  const blockId = bot.registry.blocksByName[blockName]?.id
  if (!blockId) throw new Error(`Unknown block: ${blockName}`)

  const nearby = bot.findBlock({
    matching: blockId,
    maxDistance: 8
  })
  if (nearby) return nearby

  await craftUntilAtLeast(blockName, 1, false)
  const item = findItem(blockName)
  if (!item) throw new Error(`No ${blockName} in inventory to place.`)

  await bot.equip(item, 'hand')
  const reference = findPlacementReference()
  if (!reference) throw new Error(`Could not find a safe nearby location to place ${blockName}.`)

  await bot.placeBlock(reference, new Vec3(0, 1, 0))
  await sleep(500)

  const placed = bot.findBlock({
    matching: blockId,
    maxDistance: 8
  })
  if (!placed) throw new Error(`Placed ${blockName}, but could not locate it.`)
  return placed
}

function findPlacementReference () {
  const origin = bot.entity.position.floored()
  const offsets = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, -1],
    [1, -1],
    [-1, 1]
  ]

  for (const [dx, dz] of offsets) {
    const reference = bot.blockAt(origin.offset(dx, -1, dz))
    const target = bot.blockAt(origin.offset(dx, 0, dz))
    if (reference?.boundingBox === 'block' && target?.boundingBox === 'empty') {
      return reference
    }
  }

  return null
}

async function huntFoodIfNeeded () {
  while (runningMilestone && countFoodItems() < config.targets.food) {
    const animal = nearestEntity(entity => {
      return entity.type === 'mob' &&
        FOOD_MOBS.has(entity.name) &&
        entity.position.distanceTo(bot.entity.position) <= config.collectionRadius
    })

    if (!animal) {
      console.log('No nearby food animals found; continuing with auto-eat enabled.')
      return
    }

    console.log(`Hunting ${animal.name} for food.`)
    await equipBestWeapon()
    await bot.pvp.attack(animal)
    await waitForCombatToFinish()
    await sleep(1000)
  }
}

async function smeltIron () {
  const smeltables = ['raw_iron', 'iron_ore', 'deepslate_iron_ore']
  const input = findFirstItem(smeltables)
  if (!input) {
    console.log('No iron ore or raw iron to smelt.')
    return
  }

  await craftUntilAtLeast('furnace', 1, true)
  const furnaceBlock = await findOrPlaceBlock('furnace')
  const fuel = findFirstItem(FUEL_NAMES)
  if (!fuel) throw new Error('No furnace fuel found for smelting iron.')

  const count = input.count
  const ingotsBefore = countItems(['iron_ingot'])
  const furnace = await bot.openFurnace(furnaceBlock)

  try {
    await furnace.putInput(input.type, null, count)
    await furnace.putFuel(fuel.type, null, Math.max(1, Math.min(fuel.count, count)))

    const deadline = Date.now() + (count * 12000) + 5000
    while (Date.now() < deadline && countItems(['iron_ingot']) < ingotsBefore + count) {
      if (furnace.outputItem()) {
        await furnace.takeOutput()
      }
      await sleep(1000)
    }

    if (furnace.outputItem()) {
      await furnace.takeOutput()
    }
  } finally {
    furnace.close()
  }
}

async function craftOptionalIronGear () {
  await craftIfPossible('iron_pickaxe', true)
  await craftIfPossible('bucket', true)

  for (const armor of ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots']) {
    await craftIfPossible(armor, true)
  }
}

async function equipBestWeapon () {
  const weapon = findFirstItem(['iron_sword', 'stone_sword', 'wooden_sword', 'iron_axe', 'stone_axe'])
  if (weapon) await bot.equip(weapon, 'hand')
}

async function equipArmor () {
  const armorSlots = [
    ['iron_helmet', 'head'],
    ['iron_chestplate', 'torso'],
    ['iron_leggings', 'legs'],
    ['iron_boots', 'feet']
  ]

  for (const [itemName, destination] of armorSlots) {
    const item = findItem(itemName)
    if (item) await bot.equip(item, destination)
  }
}

function getNetherReadiness () {
  if (countItems(['diamond_pickaxe']) > 0) {
    return 'Milestone 1 complete: diamond-pickaxe Nether route is ready.'
  }

  if (countItems(['bucket']) > 0) {
    return 'Milestone 1 complete: bucket-based Nether portal route is ready.'
  }

  return 'Milestone 1 partially complete: core survival loop is ready, but Nether preparation still needs a bucket or diamond pickaxe.'
}

async function waitForCombatToFinish () {
  while (bot.pvp.target) {
    await sleep(500)
  }
}

function nearestEntity (predicate) {
  return bot.nearestEntity(entity => entity !== bot.entity && predicate(entity))
}

function findItem (name) {
  return bot.inventory.items().find(item => item.name === name)
}

function findFirstItem (names) {
  return names.map(findItem).find(Boolean)
}

function countItems (names) {
  return bot.inventory.items()
    .filter(item => names.includes(item.name))
    .reduce((total, item) => total + item.count, 0)
}

function countFoodItems () {
  return bot.inventory.items()
    .filter(item => bot.autoEat.foodsByName[item.name])
    .reduce((total, item) => total + item.count, 0)
}

function getInventorySummary () {
  const parts = [
    `logs=${countItems(LOG_NAMES)}`,
    `planks=${countItems(PLANK_NAMES)}`,
    `cobble=${countItems(['cobblestone'])}`,
    `iron=${countItems(['iron_ingot'])}`,
    `food=${countFoodItems()}`
  ]
  return parts.join(' ')
}

function handleFatalTaskError (err) {
  runningMilestone = false
  console.error(err)
  bot.chat(`Milestone task stopped: ${err.message}`)
}
