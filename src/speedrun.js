import { createRequire } from 'node:module'
import { HTNPlanner, operator, task } from './htn.js'

const require = createRequire(import.meta.url)
const { Vec3 } = require('vec3')
const { goals } = require('mineflayer-pathfinder')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const LOG_NAMES = [
  'oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log',
  'dark_oak_log', 'mangrove_log', 'cherry_log', 'crimson_stem', 'warped_stem',
]
const PLANK_NAMES = [
  'oak_planks', 'birch_planks', 'spruce_planks', 'jungle_planks', 'acacia_planks',
  'dark_oak_planks', 'mangrove_planks', 'cherry_planks', 'crimson_planks', 'warped_planks',
]
const WOOD_PAIRS = LOG_NAMES.map((log, i) => [log, PLANK_NAMES[i]])
const COBBLE_NAMES = ['cobblestone', 'cobbled_deepslate']
const STONE_BLOCK_NAMES = ['stone', 'cobblestone', 'deepslate', 'cobbled_deepslate']
const IRON_ORE_NAMES = ['iron_ore', 'deepslate_iron_ore']
const RAW_IRON_NAMES = ['raw_iron', ...IRON_ORE_NAMES]
const FUEL_NAMES = ['coal', 'charcoal', ...LOG_NAMES, ...PLANK_NAMES]
const WEAPON_PRIORITY = [
  'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword',
  'diamond_axe', 'iron_axe', 'stone_axe',
]
const ARMOR_SLOTS = [
  ['iron_helmet', 'head'],
  ['iron_chestplate', 'torso'],
  ['iron_leggings', 'legs'],
  ['iron_boots', 'feet'],
]
const PLACEMENT_FACES = [
  new Vec3(0, 1, 0),
  new Vec3(1, 0, 0),
  new Vec3(-1, 0, 0),
  new Vec3(0, 0, 1),
  new Vec3(0, 0, -1),
  new Vec3(0, -1, 0),
]

const SKIP_PATTERNS = ['No path', 'Timeout', 'Took to long', 'Digging aborted', 'PathStopped', 'pathfinder', 'aborted']
const isSkippable = err => SKIP_PATTERNS.some(pattern => (err?.message ?? String(err)).includes(pattern))

export class SpeedrunBot {
  constructor(bot, config) {
    this.bot = bot
    this.config = config
    this.running = false
    this.state = 'READY'
    this.skippedBlocks = new Map()
    this.lastActionName = null
    this.lastActionLogAt = 0
    this.lastPlanTrace = []
    this.lastPlanError = null
    this.rootTask = task('complete_game')
    this.planner = this._createHTNPlanner()
  }

  stop() {
    this.running = false
    this.state = 'STOPPING'
    this._cancelCurrentAction().catch(() => { })
  }

  summary() {
    const currentPlan = this.lastPlanTrace.length
      ? this.lastPlanTrace[this.lastPlanTrace.length - 1]
      : this.lastPlanError ? 'BLOCKED' : 'idle'

    return [
      `Task: ${this.state}`,
      `plan=${currentPlan}`,
      `logs=${this._count(LOG_NAMES)}`,
      `cobble=${this._count(COBBLE_NAMES)}`,
      `rawIron=${this._count(RAW_IRON_NAMES)}`,
      `ingots=${this._count(['iron_ingot'])}`,
      `bucket=${this._has('bucket') ? 'yes' : 'no'}`,
    ].join(' ')
  }

  async run() {
    this.running = true
    this.state = 'HTN_PLANNING'
    this._log('Reactive HTN planner started.')

    while (this.running) {
      if (await this._deferForCombat()) {
        await sleep(this.config.plannerTickMs)
        continue
      }

      let action
      try {
        action = this._nextHTNAction()
      } catch (err) {
        this.lastPlanError = err.message
        this.state = 'BLOCKED'
        this._log(`HTN planner blocked: ${err.message}`, { level: 'warn' })
        await sleep(1000)
        continue
      }

      if (!action) {
        this.running = false
        this.state = 'DONE'
        this._announce(this._netherReadiness())
        break
      }

      await this._perform(action)
      await sleep(this.config.plannerTickMs)
    }
  }

  _nextHTNAction() {
    this.state = 'HTN_PLANNING'
    const plan = this.planner.plan(this.rootTask, this)
    this.lastPlanTrace = plan.trace.map(step => `${step.task}.${step.method}`)
    this.lastPlanError = null
    return plan.actions[0] ?? null
  }

  _createHTNPlanner() {
    return new HTNPlanner({
      methods: this._htnMethods(),
      operators: this._htnOperators(),
    })
  }

  _htnMethods() {
    return [
      this._method('complete_game', 'milestone_one_scope', () => [task('prepare_for_nether')]),

      this._method('prepare_for_nether', 'already_ready', ctx => ctx._netherReady(), () => []),
      this._method('prepare_for_nether', 'foundation_sequence', () => [
        task('obtain_wooden_pickaxe'),
        task('obtain_stone_tools'),
        task('obtain_iron_stock'),
        task('ensure_fuel'),
        task('smelt_bucket_iron'),
        task('craft_nether_route_gear'),
      ]),

      this._method('obtain_wooden_pickaxe', 'already_have_pickaxe', ctx => ctx._has('wooden_pickaxe'), () => []),
      this._method('obtain_wooden_pickaxe', 'collect_starter_wood', ctx => ctx._woodPotential() < ctx._starterWoodTarget(), () => [
        operator('collect_starter_logs'),
      ]),
      this._method('obtain_wooden_pickaxe', 'craft_sticks', ctx => ctx._count(['stick']) < 4 && ctx._canCraftItem('stick', false), () => [
        operator('craft_sticks', { reason: 'tool handles' }),
      ]),
      this._method('obtain_wooden_pickaxe', 'ensure_planks_for_sticks', ctx => ctx._count(['stick']) < 4, () => [
        task('obtain_planks', { reason: 'stick recipe needs matching planks', label: 'stick logs' }),
      ]),
      this._method('obtain_wooden_pickaxe', 'ensure_table', ctx => ctx._needsPlacedTable(), () => [
        task('ensure_crafting_table', { reason: 'unlock table recipes' }),
      ]),
      this._method('obtain_wooden_pickaxe', 'ensure_planks_for_pickaxe', ctx => !ctx._canCraftItem('wooden_pickaxe', true), () => [
        task('obtain_planks', { reason: 'wooden pickaxe needs matching planks', label: 'pickaxe logs' }),
      ]),
      this._method('obtain_wooden_pickaxe', 'craft_pickaxe', () => [
        operator('craft_wooden_pickaxe'),
      ]),

      this._method('obtain_stone_tools', 'wait_for_wooden_pickaxe', ctx => !ctx._has('wooden_pickaxe'), () => []),
      this._method('obtain_stone_tools', 'already_have_stone_tools', ctx => ctx._has('stone_pickaxe') && ctx._has('stone_sword'), () => []),
      this._method('obtain_stone_tools', 'collect_stone_stock', ctx => ctx._count(COBBLE_NAMES) < ctx.config.targets.cobblestone, () => [
        operator('collect_stone', { target: this.config.targets.cobblestone, label: 'stone' }),
      ]),
      this._method('obtain_stone_tools', 'craft_sticks', ctx => ctx._count(['stick']) < 4 && ctx._canCraftItem('stick', false), () => [
        operator('craft_sticks', { reason: 'stone tool handles' }),
      ]),
      this._method('obtain_stone_tools', 'ensure_planks_for_sticks', ctx => ctx._count(['stick']) < 4, () => [
        task('obtain_planks', { reason: 'stone tool handles need matching planks', label: 'tool logs' }),
      ]),
      this._method('obtain_stone_tools', 'ensure_table', ctx => ctx._needsPlacedTable(), () => [
        task('ensure_crafting_table', { reason: 'restore table access' }),
      ]),
      this._method('obtain_stone_tools', 'collect_pickaxe_stone', ctx => !ctx._has('stone_pickaxe') && !ctx._canCraftItem('stone_pickaxe', true), ctx => [
        operator('collect_stone', { target: ctx._count(COBBLE_NAMES) + 3, label: 'stone' }),
      ]),
      this._method('obtain_stone_tools', 'craft_stone_pickaxe', ctx => !ctx._has('stone_pickaxe'), () => [
        operator('craft_stone_pickaxe'),
      ]),
      this._method('obtain_stone_tools', 'collect_sword_stone', ctx => !ctx._canCraftItem('stone_sword', true), ctx => [
        operator('collect_stone', { target: ctx._count(COBBLE_NAMES) + 2, label: 'stone' }),
      ]),
      this._method('obtain_stone_tools', 'craft_stone_sword', () => [
        operator('craft_stone_sword'),
      ]),

      this._method('obtain_iron_stock', 'wait_for_stone_pickaxe', ctx => !ctx._has('stone_pickaxe'), () => []),
      this._method('obtain_iron_stock', 'already_have_iron_stock', ctx => ctx._count(RAW_IRON_NAMES) + ctx._count(['iron_ingot']) >= ctx.config.targets.rawIron, () => []),
      this._method('obtain_iron_stock', 'collect_iron', () => [
        operator('collect_iron'),
      ]),

      this._method('ensure_fuel', 'wait_for_iron', ctx => ctx._count(RAW_IRON_NAMES) === 0 && ctx._count(['iron_ingot']) < 3, () => []),
      this._method('ensure_fuel', 'already_have_fuel', ctx => ctx._hasFuel(), () => []),
      this._method('ensure_fuel', 'collect_fuel_logs', () => [
        operator('collect_fuel_logs'),
      ]),

      this._method('smelt_bucket_iron', 'already_have_ingots', ctx => ctx._count(['iron_ingot']) >= 3, () => []),
      this._method('smelt_bucket_iron', 'wait_for_raw_iron', ctx => ctx._count(RAW_IRON_NAMES) === 0, () => []),
      this._method('smelt_bucket_iron', 'wait_for_fuel', ctx => !ctx._hasFuel(), () => []),
      this._method('smelt_bucket_iron', 'ensure_table', ctx => ctx._needsPlacedTable(), () => [
        task('ensure_crafting_table', { reason: 'smelting setup' }),
      ]),
      this._method('smelt_bucket_iron', 'craft_furnace', ctx => !ctx._has('furnace') && !ctx._findPlacedBlock('furnace', 6) && ctx._canCraftItem('furnace', true), () => [
        operator('craft_furnace'),
      ]),
      this._method('smelt_bucket_iron', 'collect_furnace_stone', ctx => !ctx._has('furnace') && !ctx._findPlacedBlock('furnace', 6), ctx => [
        operator('collect_stone', { target: ctx._count(COBBLE_NAMES) + 8, label: 'furnace stone' }),
      ]),
      this._method('smelt_bucket_iron', 'place_furnace', ctx => !ctx._findPlacedBlock('furnace', 6), () => [
        operator('place_furnace'),
      ]),
      this._method('smelt_bucket_iron', 'smelt_iron', () => [
        operator('smelt_iron'),
      ]),

      this._method('craft_nether_route_gear', 'already_ready', ctx => ctx._netherReady(), () => []),
      this._method('craft_nether_route_gear', 'wait_for_ingots', ctx => ctx._count(['iron_ingot']) < 3, () => []),
      this._method('craft_nether_route_gear', 'ensure_table', ctx => ctx._needsPlacedTable(), () => [
        task('ensure_crafting_table', { reason: 'bucket route setup' }),
      ]),
      this._method('craft_nether_route_gear', 'craft_bucket_route', () => [
        operator('craft_bucket_route'),
      ]),

      this._method('ensure_crafting_table', 'already_placed', ctx => !ctx._needsPlacedTable(), () => []),
      this._method('ensure_crafting_table', 'craft_table', ctx => !ctx._has('crafting_table') && ctx._canCraftItem('crafting_table', false), (_ctx, params) => [
        operator('craft_table', { reason: params.reason }),
      ]),
      this._method('ensure_crafting_table', 'obtain_planks_for_table', ctx => !ctx._has('crafting_table'), (_ctx, params) => [
        task('obtain_planks', { reason: 'crafting table needs four matching planks', label: params.label ?? 'table logs' }),
      ]),
      this._method('ensure_crafting_table', 'place_table', (_ctx, params) => [
        operator('place_table', { reason: params.reason }),
      ]),

      this._method('obtain_planks', 'craft_from_logs', ctx => ctx._count(LOG_NAMES) > 0, (_ctx, params) => [
        operator('craft_planks', { reason: params.reason ?? 'craft planks' }),
      ]),
      this._method('obtain_planks', 'collect_logs', (_ctx, params) => [
        operator('collect_logs', { label: params.label ?? 'logs' }),
      ]),
    ]
  }

  _htnOperators() {
    return [
      this._operator('collect_starter_logs', ctx => {
        const targetLogs = ctx._count(LOG_NAMES) + Math.ceil((ctx._starterWoodTarget() - ctx._woodPotential()) / 4)
        return ctx._collectAction('COLLECT_STARTER_LOGS', LOG_NAMES, LOG_NAMES, targetLogs, 'starter logs')
      }),
      this._operator('collect_logs', (ctx, params) => {
        return ctx._collectAction('COLLECT_LOGS', LOG_NAMES, LOG_NAMES, ctx._count(LOG_NAMES) + 1, params.label)
      }),
      this._operator('collect_stone', (ctx, params) => {
        return ctx._collectAction('COLLECT_STONE', STONE_BLOCK_NAMES, COBBLE_NAMES, params.target, params.label)
      }),
      this._operator('collect_iron', ctx => {
        return ctx._collectAction('COLLECT_IRON', IRON_ORE_NAMES, RAW_IRON_NAMES, ctx.config.targets.rawIron, 'iron ore')
      }),
      this._operator('collect_fuel_logs', ctx => {
        return ctx._collectAction('COLLECT_FUEL_LOGS', LOG_NAMES, LOG_NAMES, ctx._count(LOG_NAMES) + 1, 'fuel logs')
      }),
      this._operator('craft_planks', (ctx, params) => {
        return ctx._craftAction('CRAFT_PLANKS', params.reason, () => ctx._craftPlanksFromAnyLog())
      }),
      this._operator('craft_sticks', (ctx, params) => {
        return ctx._craftAction('CRAFT_STICKS', params.reason, () => ctx._craftItem('stick', 1, false))
      }),
      this._operator('craft_table', (ctx, params) => {
        return ctx._craftAction('CRAFT_TABLE', params.reason ?? 'nearby recipe access', () => ctx._craftItem('crafting_table', 1, false))
      }),
      this._operator('place_table', (ctx, params) => {
        return ctx._craftAction('PLACE_TABLE', params.reason ?? 'nearby recipe access', () => ctx._findOrPlace('crafting_table'))
      }),
      this._operator('craft_wooden_pickaxe', ctx => {
        return ctx._craftAction('CRAFT_WOODEN_PICKAXE', 'unlock stone mining', () => ctx._craftItem('wooden_pickaxe', 1, true))
      }),
      this._operator('craft_stone_pickaxe', ctx => {
        return ctx._craftAction('CRAFT_STONE_PICKAXE', 'faster mining', () => ctx._craftItem('stone_pickaxe', 1, true))
      }),
      this._operator('craft_stone_sword', ctx => {
        return ctx._craftAction('CRAFT_STONE_SWORD', 'basic defense', () => ctx._craftStoneSword())
      }),
      this._operator('craft_furnace', ctx => {
        return ctx._craftAction('CRAFT_FURNACE', 'smelting setup', () => ctx._craftItem('furnace', 1, true))
      }),
      this._operator('place_furnace', ctx => {
        return ctx._craftAction('PLACE_FURNACE', 'smelting setup', () => ctx._findOrPlace('furnace'))
      }),
      this._operator('smelt_iron', ctx => {
        return ctx._action('SMELT_IRON', `${ctx._count(RAW_IRON_NAMES)} raw iron queued`, () => ctx._smeltIron(), ctx.config.smeltingTimeoutMs)
      }),
      this._operator('craft_bucket_route', ctx => {
        return ctx._action('CRAFT_BUCKET_ROUTE', 'bucket portal route is fastest', () => ctx._craftBucketRoute(), ctx.config.craftingTimeoutMs)
      }),
    ]
  }

  _method(taskName, name, precondition, subtasks = null) {
    if (subtasks === null) {
      subtasks = precondition
      precondition = null
    }

    return {
      task: taskName,
      name,
      precondition,
      subtasks,
    }
  }

  _operator(name, action, precondition = null) {
    return { name, action, precondition }
  }

  _woodPotential() {
    const logs = this._count(LOG_NAMES)
    const planks = this._count(PLANK_NAMES)
    return logs * 4 + planks
  }

  _starterWoodTarget() {
    return Math.max(3, this.config.targets.logs) * 4
  }

  _needsPlacedTable() {
    return !this._findPlacedBlock('crafting_table', 6)
  }

  _netherReady() {
    return this._has('diamond_pickaxe') || this._has('bucket')
  }

  _action(name, reason, run, timeoutMs) {
    return { name, reason, run, timeoutMs }
  }

  _collectAction(name, blockNames, itemNames, target, label) {
    const have = this._count(itemNames)
    const reason = `${have}/${target}`
    return this._action(
      name,
      reason,
      () => this._collectBatch(blockNames, itemNames, target, label),
      this.config.collectBlockTimeoutMs * this.config.collectBatchSize +
      this.config.dropPickupTimeoutMs * (this.config.collectBatchSize + 1) +
      500
    )
  }

  _craftAction(name, reason, run) {
    return this._action(name, reason, run, this.config.craftingStepTimeoutMs)
  }

  async _perform(action) {
    this.state = action.name
    this._logAction(action)

    try {
      await this._withTimeout(
        Promise.resolve().then(action.run),
        action.timeoutMs ?? this.config.actionTimeoutMs,
        action.name,
        () => this._cancelCurrentAction()
      )
    } catch (err) {
      this._log(`${action.name} failed fast: ${err.message}`, { level: 'warn' })
      await this._cancelCurrentAction()
      await sleep(150)
    }
  }

  _logAction(action) {
    const now = Date.now()
    if (this.lastActionName === action.name && now - this.lastActionLogAt < 2000) return
    const note = action.reason ? ` (${action.reason})` : ''
    this._log(`${action.name}${note}`)
    this.lastActionName = action.name
    this.lastActionLogAt = now
  }

  async _deferForCombat() {
    if (!this.bot.pvp?.target) return false
    this.state = 'DEFEND'
    await this._equipBestWeapon()
    await sleep(200)
    return true
  }

  async _collectBatch(blockNames, itemNames, target, label) {
    this._purgeSkippedBlocks()
    await this._pickupNearbyDrops(itemNames, this.bot.entity.position).catch(err => {
      this._log(`Pickup ${label} drops skipped: ${err.message}`, { level: 'warn' })
    })
    if (this._count(itemNames) >= target) return

    const want = Math.max(1, target - this._count(itemNames))
    const candidates = this._findBlocks(blockNames, Math.max(16, want + this.skippedBlocks.size))
      .filter(block => !this._isSkipped(block))
      .sort((a, b) => this._blockScore(a) - this._blockScore(b))
      .slice(0, Math.min(want, this.config.collectBatchSize))

    if (candidates.length === 0) {
      throw new Error(`No unskipped ${label} within ${this.config.collectionRadius} blocks.`)
    }

    for (const block of candidates) {
      if (!this.running || this._count(itemNames) >= target) break

      try {
        await this._collectBlock(block, itemNames, label)
      } catch (err) {
        this._markSkipped(block, label, err)
        if (!isSkippable(err)) throw err
      }
    }
  }

  async _collectBlock(block, itemNames, label) {
    if (this._canFastDig(block)) {
      await this._withTimeout(
        this._digNearbyBlock(block),
        Math.min(1500, this.config.collectBlockTimeoutMs),
        `dig nearby ${label}`
      )
      await this._pickupNearbyDrops(itemNames, block.position).catch(err => {
        this._log(`Pickup ${label} drops skipped: ${err.message}`, { level: 'warn' })
      })
      return
    }

    await this._withTimeout(
      this.bot.collectBlock.collect(block, { ignoreNoPath: true }),
      this.config.collectBlockTimeoutMs,
      `collect ${label}`,
      () => this._cancelCurrentAction()
    )
    await this._pickupNearbyDrops(itemNames, block.position).catch(() => { })
  }

  _canFastDig(block) {
    const center = block.position.offset(0.5, 0.5, 0.5)
    return this.bot.canDigBlock?.(block) && center.distanceTo(this.bot.entity.position) <= 2.4
  }

  async _digNearbyBlock(block) {
    if (this.bot.tool?.equipForBlock) {
      await this.bot.tool.equipForBlock(block, {
        requireHarvest: true,
        getFromChest: false,
        maxTools: 1,
      }).catch(() => { })
    } else {
      const tool = this.bot.pathfinder?.bestHarvestTool?.(block)
      if (tool) await this.bot.equip(tool, 'hand').catch(() => { })
    }

    await this.bot.dig(block)
    await sleep(250)
  }

  async _pickupNearbyDrops(itemNames, nearPosition) {
    const deadline = Date.now() + this.config.dropPickupTimeoutMs

    while (this.running && Date.now() < deadline) {
      const drop = this._nearestDrop(itemNames, nearPosition)
      if (!drop) return

      const remaining = Math.max(250, deadline - Date.now())
      await this._withTimeout(
        this._moveToDrop(drop),
        remaining,
        `pickup ${this._dropName(drop) ?? 'drop'}`,
        () => this.bot.pathfinder?.stop?.()
      ).catch(() => { })
      await sleep(150)
    }
  }

  async _moveToDrop(drop) {
    if (!drop?.isValid) return

    if (drop.position.distanceTo(this.bot.entity.position) > 1.2) {
      const { x, y, z } = drop.position
      await this.bot.pathfinder.goto(new goals.GoalNear(x, y, z, 1))
    }

    await sleep(250)
  }

  _nearestDrop(itemNames, nearPosition) {
    return Object.values(this.bot.entities)
      .filter(entity => {
        const name = this._dropName(entity)
        return name &&
          itemNames.includes(name) &&
          entity.position.distanceTo(nearPosition) <= this.config.dropPickupRadius
      })
      .sort((a, b) => {
        const botPosition = this.bot.entity.position
        return a.position.distanceTo(botPosition) - b.position.distanceTo(botPosition)
      })[0] ?? null
  }

  _dropName(entity) {
    try {
      return entity?.getDroppedItem?.()?.name ?? null
    } catch {
      return null
    }
  }

  _blockScore(block) {
    const position = this.bot.entity.position
    const distance = block.position.distanceTo(position)
    const upwardPenalty = Math.max(0, block.position.y - position.y) * 4
    const downwardPenalty = Math.max(0, position.y - block.position.y) * 0.35
    return distance + upwardPenalty + downwardPenalty
  }

  _markSkipped(block, label, err) {
    const key = this._blockKey(block)
    this.skippedBlocks.set(key, Date.now() + this.config.skipBlockTtlMs)
    this._log(`Skip ${label} at ${block.position}: ${err.message}`, { level: 'warn' })
  }

  _isSkipped(block) {
    const expiresAt = this.skippedBlocks.get(this._blockKey(block))
    if (!expiresAt) return false
    if (expiresAt > Date.now()) return true
    this.skippedBlocks.delete(this._blockKey(block))
    return false
  }

  _purgeSkippedBlocks() {
    const now = Date.now()
    for (const [key, expiresAt] of this.skippedBlocks) {
      if (expiresAt <= now) this.skippedBlocks.delete(key)
    }
  }

  _blockKey(block) {
    return `${block.name}:${block.position.x},${block.position.y},${block.position.z}`
  }

  async _craftStoneSword() {
    if (!this._has('stone_sword')) await this._craftItem('stone_sword', 1, true)
    await this._equipBestWeapon()
  }

  async _craftBucketRoute() {
    if (!this._has('bucket')) await this._craftItem('bucket', 1, true)
    await this._craftIfCan('iron_pickaxe', true)

    for (const piece of ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots']) {
      await this._craftIfCan(piece, true)
    }

    await this._equipArmor()
    await this._equipBestWeapon()
  }

  async _ensurePlanks(target) {
    while (this._count(PLANK_NAMES) < target) {
      await this._craftPlanksFromAnyLog()
    }
  }

  async _craftPlanksFromAnyLog() {
    const pair = WOOD_PAIRS.find(([log]) => this._count([log]) > 0)
    if (!pair) throw new Error('No logs available to craft planks.')
    await this._craftItem(pair[1], 1, false)
  }

  async _craftItem(name, times, needsTable) {
    const reg = this.bot.registry.itemsByName[name]
    if (!reg) throw new Error(`Unknown item: ${name}`)

    const table = needsTable ? await this._findOrPlace('crafting_table') : null
    const recipe = this.bot.recipesFor(reg.id, null, 1, table)[0]
    if (!recipe) {
      throw new Error(`No recipe for ${name} with current inventory: ${this._woodInventorySummary()}.`)
    }

    this._log(`Crafting ${name}`)
    await this.bot.craft(recipe, times, table)
  }

  async _craftIfCan(name, needsTable) {
    if (this._has(name)) return
    try {
      await this._craftItem(name, 1, needsTable)
    } catch {
      this._log(`Cannot craft ${name} yet, skipping.`)
    }
  }

  async _findOrPlace(blockName) {
    const id = this.bot.registry.blocksByName[blockName]?.id
    if (!id) throw new Error(`Unknown block: ${blockName}`)

    const existing = this.bot.findBlock({ matching: id, maxDistance: 6 })
    if (existing) return existing

    if (!this._has(blockName)) await this._craftItem(blockName, 1, false)
    const item = this._findItem(blockName)
    if (!item) throw new Error(`No ${blockName} in inventory.`)

    await this.bot.equip(item, 'hand')
    const placement = this._placementCandidate()
    if (!placement) throw new Error(`No open placement face nearby for ${blockName}.`)

    await this.bot.placeBlock(placement.reference, placement.face)
    await sleep(150)

    const placedAtTarget = this.bot.blockAt(placement.target)
    const placed = placedAtTarget?.type === id
      ? placedAtTarget
      : this.bot.findBlock({ matching: id, maxDistance: 6 })
    if (!placed) throw new Error(`Placed ${blockName} but could not locate it.`)
    return placed
  }

  _findPlacedBlock(blockName, maxDistance) {
    const id = this.bot.registry.blocksByName[blockName]?.id
    if (!id) return null
    return this.bot.findBlock({ matching: id, maxDistance })
  }

  _placementCandidate() {
    const origin = this.bot.entity.position.floored()
    const candidates = []

    for (let dy = -1; dy <= 2; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        for (let dz = -3; dz <= 3; dz++) {
          if (dx === 0 && dz === 0) continue

          const targetPos = origin.offset(dx, dy, dz)
          const target = this.bot.blockAt(targetPos)
          if (target?.boundingBox !== 'empty' || this._isBotBodySpace(targetPos)) continue

          for (const face of PLACEMENT_FACES) {
            const reference = this.bot.blockAt(targetPos.minus(face))
            if (reference?.boundingBox !== 'block') continue

            candidates.push({
              reference,
              face,
              target: targetPos,
              score: this._placementScore(targetPos, face),
            })
          }
        }
      }
    }

    return candidates.sort((a, b) => a.score - b.score)[0] ?? null
  }

  _placementScore(targetPos, face) {
    const origin = this.bot.entity.position.floored()
    const distance = targetPos.distanceTo(origin)
    const floorPreference = targetPos.y === origin.y ? 0 : Math.abs(targetPos.y - origin.y) * 2
    const facePreference = face.y === 1 ? -1 : face.y === 0 ? 0 : 1
    return distance + floorPreference + facePreference
  }

  _isBotBodySpace(position) {
    const origin = this.bot.entity.position.floored()
    return position.x === origin.x &&
      position.z === origin.z &&
      (position.y === origin.y || position.y === origin.y + 1)
  }

  async _smeltIron() {
    const input = this._findFirstItem(RAW_IRON_NAMES)
    if (!input) throw new Error('No iron to smelt.')

    if (!this._has('furnace')) await this._craftItem('furnace', 1, true)
    const furnaceBlock = await this._findOrPlace('furnace')
    const fuel = this._findFirstItem(FUEL_NAMES)
    if (!fuel) throw new Error('No fuel available for furnace.')

    const count = input.count
    const before = this._count(['iron_ingot'])
    const furnace = await this.bot.openFurnace(furnaceBlock)

    try {
      await furnace.putInput(input.type, null, count)
      await furnace.putFuel(fuel.type, null, Math.max(1, Math.min(fuel.count, count + 2)))

      const deadline = Date.now() + count * 11_000 + 5_000
      while (this.running && Date.now() < deadline && this._count(['iron_ingot']) < before + count) {
        if (furnace.outputItem()) await furnace.takeOutput()
        await sleep(500)
      }

      if (furnace.outputItem()) await furnace.takeOutput()
    } finally {
      furnace.close()
    }
  }

  async _equipBestWeapon() {
    const weapon = this._findFirstItem(WEAPON_PRIORITY)
    if (weapon) await this.bot.equip(weapon, 'hand').catch(() => { })
  }

  async _equipArmor() {
    for (const [name, slot] of ARMOR_SLOTS) {
      const item = this._findItem(name)
      if (item) await this.bot.equip(item, slot).catch(() => { })
    }
  }

  _count(names) {
    return this.bot.inventory.items()
      .filter(item => names.includes(item.name))
      .reduce((sum, item) => sum + item.count, 0)
  }

  _has(name) {
    return this.bot.inventory.items().some(item => item.name === name)
  }

  _hasFuel() {
    return this._findFirstItem(FUEL_NAMES) !== undefined
  }

  _findItem(name) {
    return this.bot.inventory.items().find(item => item.name === name)
  }

  _findFirstItem(names) {
    return names.map(name => this._findItem(name)).find(Boolean)
  }

  _findBlocks(names, count) {
    const ids = names.map(name => this.bot.registry.blocksByName[name]?.id).filter(Boolean)
    if (!ids.length) return []

    return this.bot.findBlocks({
      matching: ids,
      maxDistance: this.config.collectionRadius,
      count,
    }).map(pos => this.bot.blockAt(pos)).filter(Boolean)
  }

  _canCraftItem(name, needsTable) {
    const reg = this.bot.registry.itemsByName[name]
    if (!reg) return false

    const table = needsTable ? this._findPlacedBlock('crafting_table', 6) : null
    return this.bot.recipesFor(reg.id, null, 1, table).length > 0
  }

  _woodInventorySummary() {
    const parts = [
      `logs=${this._count(LOG_NAMES)}`,
      `planks=${this._count(PLANK_NAMES)}`,
      `sticks=${this._count(['stick'])}`,
      `tables=${this._count(['crafting_table'])}`,
    ]
    const plankStacks = this.bot.inventory.items()
      .filter(item => PLANK_NAMES.includes(item.name))
      .map(item => `${item.name}:${item.count}`)

    return plankStacks.length ? `${parts.join(', ')} (${plankStacks.join(', ')})` : parts.join(', ')
  }

  _log(message, { level = 'log' } = {}) {
    const text = `[${this._timestamp()}] ${message}`
    const writer = typeof console[level] === 'function' ? console[level] : console.log
    writer.call(console, text)
  }

  _timestamp() {
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const ss = String(now.getSeconds()).padStart(2, '0')
    return `${hh}:${mm}:${ss}`
  }

  async _withTimeout(promise, timeoutMs, label, onTimeout = null) {
    let timer
    let timedOut = false
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true
        reject(new Error(`${label} exceeded ${timeoutMs}ms`))
      }, timeoutMs)
    })

    try {
      return await Promise.race([promise, timeout])
    } catch (err) {
      if (timedOut && onTimeout) await onTimeout().catch(() => { })
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  async _cancelCurrentAction() {
    await this.bot.collectBlock?.cancelTask?.().catch(() => { })
    this.bot.pathfinder?.stop?.()
    this.bot.pathfinder?.setGoal?.(null)
  }

  _announce(message) {
    this._log(message)
  }

  _netherReadiness() {
    if (this._has('diamond_pickaxe')) return 'Requirements met: diamond pickaxe Nether route ready.'
    if (this._has('bucket')) return 'Requirements met: bucket portal route ready.'
    return 'Core gear crafted; Nether prep still needs a bucket or diamond pickaxe.'
  }
}

export { SpeedrunBot as MinecraftBot }
