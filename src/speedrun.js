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
const GRAVEL_NAMES = ['gravel']
const FILLER_BLOCK_NAMES = [
  ...COBBLE_NAMES, 'dirt', 'stone', 'deepslate', 'andesite', 'diorite', 'granite',
]
const WEAPON_PRIORITY = [
  'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword',
  'diamond_axe', 'iron_axe', 'stone_axe',
]
const PICKAXE_PRIORITY = ['diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'wooden_pickaxe']
const MINING_PICKAXE_NAMES = ['diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe']
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
const PORTAL_FRAME_OFFSETS = [
  [1, 0], [2, 0],
  [0, 1], [3, 1],
  [0, 2], [3, 2],
  [0, 3], [3, 3],
  [1, 4], [2, 4],
]
const PORTAL_INTERIOR_OFFSETS = [
  [1, 1], [2, 1],
  [1, 2], [2, 2],
  [1, 3], [2, 3],
]
const LIQUID_SEARCH_DIRECTIONS = [
  [1, 0], [1, 1], [0, 1], [-1, 1],
  [-1, 0], [-1, -1], [0, -1], [1, -1],
]

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
    this.portalPlan = null
    this.liquidSearches = new Map()
    this.rejectedLavaSources = new Map()
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
      `water=${this._has('water_bucket') ? 'bucket' : this._findLiquidSources('water', 1).length ? 'near' : 'search'}`,
      `lava=${this._hasNearbyLavaForPortal() ? 'pool' : this._findSeenLavaSource() ? 'seen' : 'search'}`,
      `flintSteel=${this._has('flint_and_steel') ? 'yes' : 'no'}`,
      `portal=${this._findNearbyPortalBlock() ? 'lit' : this._hasPortalFrameComplete() ? 'frame' : 'no'}`,
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
        this._announce(this._netherEntryStatus())
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
      this._method('complete_game', 'nether_entry_scope', () => [task('enter_nether')]),

      this._method('enter_nether', 'already_in_nether', ctx => ctx._inNether(), () => []),
      this._method('enter_nether', 'lit_portal_available', ctx => ctx._findNearbyPortalBlock(), () => [
        operator('enter_nether_portal'),
      ]),
      this._method('enter_nether', 'portal_frame_ready', ctx => ctx._hasPortalFrameComplete(), () => [
        operator('light_nether_portal'),
      ]),
      this._method('enter_nether', 'bucket_casting_route', () => [
        task('prepare_for_nether'),
        task('maintain_overworld_tools'),
        task('obtain_ignition'),
        task('obtain_water_bucket'),
        task('reach_portal_lava_pool'),
        task('ensure_portal_support_blocks'),
        operator('build_bucket_portal'),
        operator('light_nether_portal'),
        operator('enter_nether_portal'),
      ]),

      this._method('prepare_for_nether', 'already_ready', ctx => ctx._hasBucketRouteGear(), () => []),
      this._method('prepare_for_nether', 'foundation_sequence', () => [
        task('obtain_wooden_pickaxe'),
        task('obtain_stone_tools'),
        task('obtain_iron_stock'),
        task('ensure_fuel'),
        task('smelt_bucket_iron'),
        task('craft_nether_route_gear'),
      ]),

      this._method('maintain_overworld_tools', 'tools_ready', ctx => ctx._hasMiningPickaxe() && ctx._has('stone_sword'), () => []),
      this._method('maintain_overworld_tools', 'craft_replacement_pickaxe', ctx => {
        return !ctx._hasMiningPickaxe() &&
          ctx._count(COBBLE_NAMES) >= 3 &&
          ctx._count(['stick']) >= 2
      }, () => [
        task('ensure_crafting_table', { reason: 'replace broken pickaxe' }),
        operator('craft_stone_pickaxe'),
      ]),
      this._method('maintain_overworld_tools', 'replace_basic_tools', () => [
        task('obtain_wooden_pickaxe'),
        task('obtain_stone_tools'),
      ]),

      this._method('obtain_wooden_pickaxe', 'already_have_pickaxe', ctx => ctx._hasAnyPickaxe(), () => []),
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

      this._method('obtain_stone_tools', 'wait_for_pickaxe', ctx => !ctx._hasAnyPickaxe(), () => []),
      this._method('obtain_stone_tools', 'already_have_stone_tools', ctx => ctx._hasMiningPickaxe() && ctx._has('stone_sword'), () => []),
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
      this._method('obtain_stone_tools', 'collect_pickaxe_stone', ctx => !ctx._hasMiningPickaxe() && !ctx._canCraftItem('stone_pickaxe', true), ctx => [
        operator('collect_stone', { target: ctx._count(COBBLE_NAMES) + 3, label: 'stone' }),
      ]),
      this._method('obtain_stone_tools', 'craft_stone_pickaxe', ctx => !ctx._hasMiningPickaxe(), () => [
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

      this._method('smelt_bucket_iron', 'already_have_ingots', ctx => ctx._count(['iron_ingot']) >= 3 || ctx._has('bucket'), () => []),
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

      this._method('craft_nether_route_gear', 'already_ready', ctx => ctx._hasBucketRouteGear(), () => []),
      this._method('craft_nether_route_gear', 'wait_for_ingots', ctx => ctx._count(['iron_ingot']) < 3, () => []),
      this._method('craft_nether_route_gear', 'ensure_table', ctx => ctx._needsPlacedTable(), () => [
        task('ensure_crafting_table', { reason: 'bucket route setup' }),
      ]),
      this._method('craft_nether_route_gear', 'craft_bucket_route', () => [
        operator('craft_bucket_route'),
      ]),

      this._method('obtain_ignition', 'already_have_flint_and_steel', ctx => ctx._has('flint_and_steel'), () => []),
      this._method('obtain_ignition', 'obtain_flint', ctx => !ctx._has('flint'), () => [
        operator('collect_flint'),
      ]),
      this._method('obtain_ignition', 'obtain_extra_ingot', ctx => ctx._count(['iron_ingot']) < 1, () => [
        task('ensure_iron_ingots', { count: 1 }),
      ]),
      this._method('obtain_ignition', 'craft_flint_and_steel', () => [
        operator('craft_flint_and_steel'),
      ]),

      this._method('obtain_water_bucket', 'already_have_water', ctx => ctx._has('water_bucket') || ctx._hasPortalFrameComplete(), () => []),
      this._method('obtain_water_bucket', 'collect_nearby_water', ctx => ctx._has('bucket') && ctx._findLiquidSources('water', 1).length > 0, () => [
        operator('collect_water_bucket'),
      ]),
      this._method('obtain_water_bucket', 'search_for_water', () => [
        operator('search_water_source'),
      ]),

      this._method('reach_portal_lava_pool', 'already_at_lava_pool', ctx => ctx._hasNearbyLavaForPortal() || ctx._hasPortalFrameComplete(), () => []),
      this._method('reach_portal_lava_pool', 'move_to_seen_lava', ctx => ctx._shouldMoveToSeenLava(), () => [
        operator('move_to_lava_pool'),
      ]),
      this._method('reach_portal_lava_pool', 'search_for_lava_pool', () => [
        operator('search_lava_pool'),
      ]),

      this._method('ensure_iron_ingots', 'already_have_ingots', (ctx, params) => ctx._count(['iron_ingot']) >= params.count, () => []),
      this._method('ensure_iron_ingots', 'collect_more_iron', ctx => ctx._count(RAW_IRON_NAMES) === 0, () => [
        operator('collect_iron'),
      ]),
      this._method('ensure_iron_ingots', 'collect_fuel', ctx => !ctx._hasFuel(), () => [
        operator('collect_fuel_logs'),
      ]),
      this._method('ensure_iron_ingots', 'ensure_table', ctx => ctx._needsPlacedTable(), () => [
        task('ensure_crafting_table', { reason: 'smelting setup' }),
      ]),
      this._method('ensure_iron_ingots', 'craft_furnace', ctx => !ctx._has('furnace') && !ctx._findPlacedBlock('furnace', 6) && ctx._canCraftItem('furnace', true), () => [
        operator('craft_furnace'),
      ]),
      this._method('ensure_iron_ingots', 'collect_furnace_stone', ctx => !ctx._has('furnace') && !ctx._findPlacedBlock('furnace', 6), ctx => [
        operator('collect_stone', { target: ctx._count(COBBLE_NAMES) + 8, label: 'furnace stone' }),
      ]),
      this._method('ensure_iron_ingots', 'place_furnace', ctx => !ctx._findPlacedBlock('furnace', 6), () => [
        operator('place_furnace'),
      ]),
      this._method('ensure_iron_ingots', 'smelt_iron', () => [
        operator('smelt_iron'),
      ]),

      this._method('ensure_portal_support_blocks', 'already_have_support', ctx => ctx._fillerBlockCount() >= ctx.config.targets.portalSupportBlocks, () => []),
      this._method('ensure_portal_support_blocks', 'collect_support_stone', ctx => {
        const missing = ctx.config.targets.portalSupportBlocks - ctx._fillerBlockCount()
        return [operator('collect_stone', { target: ctx._count(COBBLE_NAMES) + missing, label: 'portal support stone' })]
      }),

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
      this._operator('collect_flint', ctx => {
        return ctx._collectAction('COLLECT_FLINT', GRAVEL_NAMES, ['flint'], 1, 'flint from gravel')
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
        return ctx._craftAction('CRAFT_STONE_PICKAXE', 'faster mining', async () => {
          await ctx._craftItem('stone_pickaxe', 1, true)
          await ctx._equipBestPickaxe()
        })
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
      this._operator('craft_flint_and_steel', ctx => {
        return ctx._craftAction('CRAFT_FLINT_AND_STEEL', 'portal ignition', () => ctx._craftItem('flint_and_steel', 1, false))
      }),
      this._operator('collect_water_bucket', ctx => {
        return ctx._action('COLLECT_WATER_BUCKET', 'carry water to lava pool', () => ctx._collectLiquidSource('water'), ctx.config.liquidSearchTimeoutMs)
      }),
      this._operator('search_water_source', ctx => {
        return ctx._action('SEARCH_WATER_SOURCE', 'walk search pattern for water', () => ctx._searchForLiquidSource('water'), ctx.config.liquidSearchTimeoutMs)
      }),
      this._operator('move_to_lava_pool', ctx => {
        return ctx._action('MOVE_TO_LAVA_POOL', 'build portal near lava sources', () => ctx._moveToLiquidSourceArea('lava'), ctx.config.liquidSearchTimeoutMs)
      }),
      this._operator('search_lava_pool', ctx => {
        return ctx._action('SEARCH_LAVA_POOL', 'walk search pattern for lava', () => ctx._searchForLiquidSource('lava'), ctx.config.liquidSearchTimeoutMs)
      }),
      this._operator('build_bucket_portal', ctx => {
        return ctx._action('BUILD_BUCKET_PORTAL', 'single bucket lava-water casting', () => ctx._buildBucketPortal(), ctx.config.portalBuildTimeoutMs)
      }),
      this._operator('light_nether_portal', ctx => {
        return ctx._action('LIGHT_NETHER_PORTAL', 'ignite obsidian frame', () => ctx._lightNetherPortal(), ctx.config.portalLightTimeoutMs)
      }),
      this._operator('enter_nether_portal', ctx => {
        return ctx._action('ENTER_NETHER', 'stand in portal until dimension changes', () => ctx._enterNetherPortal(), ctx.config.portalEnterTimeoutMs)
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

  _hasBucketRouteGear() {
    return this._has('bucket') || this._has('water_bucket') || this._has('lava_bucket')
  }

  _hasAnyPickaxe() {
    return this._findFirstItem(PICKAXE_PRIORITY) !== undefined
  }

  _hasMiningPickaxe() {
    return this._findFirstItem(MINING_PICKAXE_NAMES) !== undefined
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
      this._collectActionTimeout()
    )
  }

  _collectActionTimeout() {
    const perBlockTimeout = this.config.collectMoveTimeoutMs +
      this.config.collectDigTimeoutMs +
      this.config.dropPickupTimeoutMs +
      500
    return perBlockTimeout * this.config.collectBatchSize + this.config.dropPickupTimeoutMs + 500
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
        this.config.collectDigTimeoutMs,
        `dig nearby ${label}`
      )
      await this._pickupNearbyDrops(itemNames, block.position).catch(err => {
        this._log(`Pickup ${label} drops skipped: ${err.message}`, { level: 'warn' })
      })
      return
    }

    await this._moveNearCollectBlock(block, label)
    await this._withTimeout(
      this._digNearbyBlock(block),
      this.config.collectDigTimeoutMs,
      `dig ${label}`
    )
    await this._pickupNearbyDrops(itemNames, block.position).catch(() => { })
  }

  async _moveNearCollectBlock(block, label) {
    if (this._canFastDig(block)) return

    const { x, y, z } = block.position
    await this._withTimeout(
      this.bot.pathfinder.goto(new goals.GoalNear(x, y, z, 2)),
      this.config.collectMoveTimeoutMs,
      `move to ${label}`,
      () => this.bot.pathfinder?.stop?.()
    )
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

  async _buildBucketPortal() {
    if (this._hasPortalFrameComplete()) return
    if (!this._hasBucketRouteGear()) throw new Error('Bucket route needs an empty bucket.')
    if (!this._has('water_bucket')) {
      throw new Error('Bucket portal casting needs water in the bucket before reaching lava.')
    }
    if (!this._hasNearbyLavaForPortal()) {
      throw new Error(`Need ${PORTAL_FRAME_OFFSETS.length} nearby lava source blocks before casting.`)
    }

    const plan = this._selectPortalBuildPlan()
    if (!plan) throw new Error('No nearby clear 4x6 portal casting site.')
    this.portalPlan = plan

    await this._buildPortalSupportWall(plan)
    await this._placeCastingWater(plan)
    await this._castObsidianFrame(plan)
    await this._removeCastingWater(plan)
    await this._clearPortalInterior(plan)

    if (!this._frameComplete(plan)) throw new Error('Bucket casting did not complete the obsidian portal frame.')
  }

  async _buildPortalSupportWall(plan) {
    for (const position of plan.supportPositions) {
      await this._placeFillerAt(position)
    }
  }

  async _placeCastingWater(plan) {
    if (!this._has('water_bucket')) await this._collectLiquidSource('water')
    await this._placeLiquidFromBucket('water', plan.waterAnchor, plan.waterSupport, new Vec3(0, 0, 1))
    await sleep(1000)
  }

  async _castObsidianFrame(plan) {
    for (const position of plan.framePositions) {
      if (this._blockNameAt(position) === 'obsidian') continue

      await this._collectLiquidSource('lava')
      await this._placeLiquidFromBucket('lava', position, position.offset(0, 0, 1), new Vec3(0, 0, -1))
      await sleep(1200)

      if (this._blockNameAt(position) !== 'obsidian') {
        await sleep(1500)
      }
      if (this._blockNameAt(position) !== 'obsidian') {
        throw new Error(`Lava at ${position} did not cast into obsidian.`)
      }
    }
  }

  async _removeCastingWater(plan) {
    if (!this._has('bucket')) return

    const water = this.bot.blockAt(plan.waterAnchor)
    if (this._isSourceLiquid(water, 'water')) {
      await this._moveNearPosition(plan.waterAnchor, 3)
      await this.bot.equip(this._findItem('bucket'), 'hand')
      await this._activateBlockWithVerification(
        water,
        null,
        'remove casting water',
        () => !this._isSourceLiquid(this.bot.blockAt(plan.waterAnchor), 'water') || this._has('water_bucket')
      )
      await sleep(750)
    }
  }

  async _clearPortalInterior(plan) {
    const deadline = Date.now() + 7000

    while (Date.now() < deadline) {
      const blockingLiquid = plan.interiorPositions.find(position => {
        const name = this._blockNameAt(position)
        return name === 'water' || name === 'lava'
      })
      if (!blockingLiquid) return
      await sleep(500)
    }

    throw new Error('Portal interior still contains liquid after casting.')
  }

  async _lightNetherPortal() {
    if (this._findNearbyPortalBlock()) return

    const plan = this.portalPlan ?? this._findPortalFramePlan()
    if (!plan || !this._frameComplete(plan)) throw new Error('No complete obsidian frame nearby to light.')

    const flintAndSteel = this._findItem('flint_and_steel')
    if (!flintAndSteel) throw new Error('No flint and steel available to light portal.')

    const bottomFrame = this.bot.blockAt(plan.base.offset(1, 0, 0))
    if (!bottomFrame) throw new Error('Cannot find portal frame block to ignite.')

    await this._moveNearPosition(plan.base.offset(1, 1, -1), 2)
    await this.bot.equip(flintAndSteel, 'hand')
    await this._activateBlockWithVerification(
      bottomFrame,
      new Vec3(0, 1, 0),
      'light nether portal',
      () => Boolean(this._findNearbyPortalBlock())
    )
    await sleep(1500)

    if (!this._findNearbyPortalBlock()) throw new Error('Portal did not ignite.')
  }

  async _enterNetherPortal() {
    const portal = this._findNearbyPortalBlock()
    if (!portal) throw new Error('No lit Nether portal nearby.')

    await this.bot.pathfinder.goto(new goals.GoalBlock(portal.position.x, portal.position.y, portal.position.z))

    const deadline = Date.now() + this.config.portalEnterTimeoutMs
    while (this.running && Date.now() < deadline) {
      if (this._inNether()) return
      await sleep(500)
    }

    throw new Error('Timed out waiting for Nether dimension change.')
  }

  async _collectLiquidSource(name) {
    const bucketName = `${name}_bucket`
    if (this._has(bucketName)) return

    const bucket = this._findItem('bucket')
    if (!bucket) throw new Error(`Need an empty bucket to collect ${name}.`)

    const source = this._findCollectableLiquidSource(name)
    if (!source) throw new Error(`No ${name} source within ${this.config.collectionRadius} blocks.`)

    await this._moveToLiquidInteractionPosition(source)
    await this.bot.equip(bucket, 'hand')
    await this._fillBucketFromSource(source, name, bucketName)
    await sleep(750)

    if (!this._has(bucketName)) throw new Error(`Failed to collect ${name} source.`)
  }

  async _fillBucketFromSource(source, name, bucketName) {
    const target = this._liquidInteractionPoint(source)

    await this.bot.lookAt(target, true)
    await this._useEquippedItemWithVerification(`collect ${name}`, () => this._has(bucketName))
      .catch(async () => {
        await this.bot.lookAt(source.position.offset(0.5, 0.5, 0.5), true)
        await this._activateBlockWithVerification(source, null, `collect ${name}`, () => this._has(bucketName))
      })
  }

  async _moveToLiquidInteractionPosition(source) {
    const position = this._liquidInteractionStandPosition(source)
    if (!position) {
      await this._moveNearPosition(source.position, 2)
      return
    }

    if (position.distanceTo(this.bot.entity.position) > 1) {
      await this.bot.pathfinder.goto(new goals.GoalBlock(position.x, position.y, position.z))
    }
  }

  async _moveToLiquidSourceArea(name) {
    const source = name === 'lava'
      ? this._findSeenLavaSource()
      : this._findLiquidSources(name, 1)[0]
    if (!source) throw new Error(`No ${name} source within ${this.config.collectionRadius} blocks.`)
    if (name === 'lava') await this._ensureTravelPickaxe()

    const range = name === 'lava' ? 7 : 3
    await this._gotoWithPickaxeGuard(new goals.GoalNear(source.position.x, source.position.y, source.position.z, range), `move to ${name}`)
    await sleep(500)

    if (name === 'lava' && !this._hasNearbyLavaForPortal()) {
      this._rejectLocalLavaSources('not enough source blocks for bucket portal')
    }
  }

  async _searchForLiquidSource(name) {
    const requiredSources = name === 'lava' ? PORTAL_FRAME_OFFSETS.length : 1
    const found = name === 'lava'
      ? this._findLocalLavaSources(requiredSources).length
      : this._findLiquidSources(name, requiredSources).length
    if (found >= requiredSources) return

    const target = this._nextLiquidSearchTarget(name)
    this._log(`Searching for ${name}: walking to ${target}.`)

    if (name === 'lava') {
      await this._ensureTravelPickaxe()
      await this._gotoWithPickaxeGuard(new goals.GoalNear(target.x, target.y, target.z, 3), `search for ${name}`)
    } else {
      await this.bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, 3))
    }
    await sleep(500)
  }

  async _ensureTravelPickaxe() {
    if (!this._hasAnyPickaxe()) throw new Error('No pickaxe available for lava-pool travel.')
    await this._equipBestPickaxe()
  }

  async _gotoWithPickaxeGuard(goal, label) {
    await this._ensureTravelPickaxe()

    let done = false
    let failure = null
    const moving = this.bot.pathfinder.goto(goal)
      .catch(err => { failure = err })
      .finally(() => { done = true })

    while (!done) {
      if (!this._hasAnyPickaxe()) {
        this.bot.pathfinder?.stop?.()
        await moving.catch(() => { })
        throw new Error(`Pickaxe broke during ${label}; replanning replacement.`)
      }
      await sleep(250)
    }

    if (failure) throw failure
  }

  async _placeLiquidFromBucket(name, targetPosition, referencePosition, face) {
    const bucket = this._findItem(`${name}_bucket`)
    if (!bucket) throw new Error(`No ${name} bucket available.`)

    const reference = this.bot.blockAt(referencePosition)
    if (!reference || reference.boundingBox !== 'block') {
      throw new Error(`No solid reference block for placing ${name} at ${targetPosition}.`)
    }

    await this._moveNearPosition(targetPosition, 4)
    await this.bot.equip(bucket, 'hand')
    await this._activateBlockWithVerification(
      reference,
      face,
      `place ${name}`,
      () => this._liquidPlacementSucceeded(name, targetPosition)
    )
    await sleep(500)

    if (name === 'water' && !this._liquidPlacementSucceeded(name, targetPosition)) {
      throw new Error(`Failed to place water at ${targetPosition}.`)
    }
    if (name === 'lava' && !this._liquidPlacementSucceeded(name, targetPosition)) {
      throw new Error(`Failed to place lava at ${targetPosition}.`)
    }
  }

  _liquidPlacementSucceeded(name, targetPosition) {
    const placedName = this._blockNameAt(targetPosition)
    if (name === 'water') return placedName === 'water'
    if (name === 'lava') return placedName === 'lava' || placedName === 'obsidian'
    return false
  }

  async _placeFillerAt(position) {
    const current = this.bot.blockAt(position)
    if (current?.boundingBox === 'block') return
    if (!this._isClearBlock(current)) throw new Error(`Cannot place support into ${current?.name ?? 'unknown'} at ${position}.`)

    const filler = this._findFillerItem()
    if (!filler) throw new Error('No filler block available for portal support wall.')

    const reference = this._placementReferenceFor(position)
    if (!reference) throw new Error(`No placement reference for portal support at ${position}.`)

    await this._moveNearPosition(position, 4)
    await this.bot.equip(filler, 'hand')
    await this._placeBlockWithVerification(reference.block, reference.face, position, 'portal support')
    await sleep(150)
  }

  async _placeBlockWithVerification(reference, face, targetPosition, label) {
    try {
      await this.bot.placeBlock(reference, face)
    } catch (err) {
      await sleep(250)
      if (this.bot.blockAt(targetPosition)?.boundingBox === 'block') {
        this._log(`${label} placement update was missed at ${targetPosition}; continuing.`, { level: 'warn' })
        return
      }
      throw err
    }

    if (this.bot.blockAt(targetPosition)?.boundingBox !== 'block') {
      throw new Error(`Placed ${label} but target is still empty at ${targetPosition}.`)
    }
  }

  async _activateBlockWithVerification(block, face, label, verify) {
    try {
      if (face) {
        await this.bot.activateBlock(block, face)
      } else {
        await this.bot.activateBlock(block)
      }
    } catch (err) {
      await sleep(500)
      if (verify()) {
        this._log(`${label} update was missed near ${block.position}; continuing.`, { level: 'warn' })
        return
      }
      throw err
    }

    if (!verify()) {
      await sleep(500)
      if (!verify()) throw new Error(`${label} did not produce the expected state.`)
    }
  }

  async _useEquippedItemWithVerification(label, verify) {
    try {
      await this.bot.activateItem()
    } catch (err) {
      await sleep(500)
      if (verify()) {
        this._log(`${label} item-use update was missed; continuing.`, { level: 'warn' })
        return
      }
      throw err
    } finally {
      this.bot.deactivateItem?.()
    }

    if (!verify()) {
      await sleep(750)
      if (!verify()) throw new Error(`${label} did not produce the expected inventory state.`)
    }
  }

  _selectPortalBuildPlan() {
    const origin = this.bot.entity.position.floored()
    const candidates = []

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        for (let dz = -5; dz <= 5; dz++) {
          const base = origin.offset(dx, dy, dz)
          const plan = this._makePortalPlan(base)
          if (!this._portalSiteIsClear(plan)) continue

          candidates.push({
            plan,
            score: base.distanceTo(origin),
          })
        }
      }
    }

    return candidates.sort((a, b) => a.score - b.score)[0]?.plan ?? null
  }

  _portalSiteIsClear(plan) {
    return [...plan.framePositions, ...plan.interiorPositions, plan.waterAnchor]
      .every(position => this._isClearBlock(this.bot.blockAt(position))) &&
      plan.supportPositions.every(position => {
        const block = this.bot.blockAt(position)
        return !block || block.boundingBox === 'block' || this._isClearBlock(block)
      }) &&
      [0, 1, 2, 3].every(x => this.bot.blockAt(plan.base.offset(x, -1, 1))?.boundingBox === 'block')
  }

  _makePortalPlan(base) {
    const framePositions = PORTAL_FRAME_OFFSETS.map(([x, y]) => base.offset(x, y, 0))
    const interiorPositions = PORTAL_INTERIOR_OFFSETS.map(([x, y]) => base.offset(x, y, 0))
    const supportPositions = []

    for (let y = 0; y <= 4; y++) {
      for (let x = 0; x <= 3; x++) {
        supportPositions.push(base.offset(x, y, 1))
      }
    }

    const waterAnchor = base.offset(1, 4, -1)
    const waterSupport = waterAnchor.offset(0, 0, -1)
    for (let y = 0; y <= 4; y++) {
      supportPositions.push(base.offset(1, y, -2))
    }

    return {
      base,
      framePositions,
      interiorPositions,
      supportPositions,
      waterAnchor,
      waterSupport,
    }
  }

  _hasPortalFrameComplete() {
    if (this.portalPlan) return this._frameComplete(this.portalPlan)
    if (!this._findPlacedBlock('obsidian', 10)) return false

    const plan = this._findPortalFramePlan()
    if (!plan) return false
    this.portalPlan = plan
    return true
  }

  _findPortalFramePlan() {
    const origin = this.bot.entity.position.floored()

    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -8; dx <= 8; dx++) {
        for (let dz = -8; dz <= 8; dz++) {
          const plan = this._makePortalPlan(origin.offset(dx, dy, dz))
          if (this._frameComplete(plan)) return plan
        }
      }
    }

    return null
  }

  _frameComplete(plan) {
    return plan.framePositions.every(position => this._blockNameAt(position) === 'obsidian') &&
      plan.interiorPositions.every(position => {
        const name = this._blockNameAt(position)
        return name === 'air' || name === 'nether_portal' || name === 'cave_air' || name === 'void_air'
      })
  }

  _findNearbyPortalBlock() {
    const id = this.bot.registry.blocksByName.nether_portal?.id
    if (!id) return null
    return this.bot.findBlock({ matching: id, maxDistance: 8 })
  }

  _findLiquidSources(name, count, maxDistance = this.config.collectionRadius) {
    const id = this.bot.registry.blocksByName[name]?.id
    if (!id) return []

    return this.bot.findBlocks({
      matching: id,
      maxDistance,
      count: Math.max(count * 8, 64),
    })
      .map(position => this.bot.blockAt(position))
      .filter(block => this._isSourceLiquid(block, name))
      .sort((a, b) => this._blockScore(a) - this._blockScore(b))
      .slice(0, count)
  }

  _findCollectableLiquidSource(name) {
    return this._findLiquidSources(name, 24)
      .filter(block => this._isCollectableLiquidSource(block))
      .sort((a, b) => this._liquidCollectionScore(a) - this._liquidCollectionScore(b))[0] ?? null
  }

  _isCollectableLiquidSource(block) {
    if (!block) return false
    const above = this.bot.blockAt(block.position.offset(0, 1, 0))
    if (this._isClearBlock(above)) return true

    return [
      new Vec3(1, 0, 0),
      new Vec3(-1, 0, 0),
      new Vec3(0, 0, 1),
      new Vec3(0, 0, -1),
    ].some(offset => this._isClearBlock(this.bot.blockAt(block.position.offset(offset.x, offset.y, offset.z))))
  }

  _liquidCollectionScore(block) {
    const distance = block.position.distanceTo(this.bot.entity.position)
    const exposedTopBonus = this._isClearBlock(this.bot.blockAt(block.position.offset(0, 1, 0))) ? -8 : 0
    const lineOfSightBonus = this._liquidInteractionStandPosition(block) ? -12 : 0
    return distance + exposedTopBonus + lineOfSightBonus
  }

  _liquidInteractionPoint(source) {
    return source.position.offset(0.5, 0.95, 0.5)
  }

  _liquidInteractionStandPosition(source) {
    const target = this._liquidInteractionPoint(source)
    const candidates = []

    for (let dy = 2; dy >= -2; dy--) {
      for (let dx = -3; dx <= 3; dx++) {
        for (let dz = -3; dz <= 3; dz++) {
          if (dx === 0 && dz === 0) continue

          const foot = source.position.offset(dx, dy, dz)
          if (!this._isStandablePosition(foot)) continue

          const eye = foot.offset(0.5, 1.62, 0.5)
          const distance = eye.distanceTo(target)
          if (distance > 4.5) continue

          const hasLine = this._hasClearLine(eye, target, source.position)
          candidates.push({
            position: foot,
            score: foot.distanceTo(this.bot.entity.position) + (hasLine ? -20 : 0),
            hasLine,
          })
        }
      }
    }

    const clear = candidates.filter(candidate => candidate.hasLine)
      .sort((a, b) => a.score - b.score)[0]
    if (clear) return clear.position

    return candidates.sort((a, b) => a.score - b.score)[0]?.position ?? null
  }

  _isStandablePosition(position) {
    const ground = this.bot.blockAt(position.offset(0, -1, 0))
    const body = this.bot.blockAt(position)
    const head = this.bot.blockAt(position.offset(0, 1, 0))
    return ground?.boundingBox === 'block' && this._isClearBlock(body) && this._isClearBlock(head)
  }

  _hasClearLine(from, to, ignoredPosition = null) {
    const distance = from.distanceTo(to)
    const steps = Math.max(1, Math.ceil(distance / 0.25))

    for (let i = 1; i < steps; i++) {
      const ratio = i / steps
      const point = new Vec3(
        from.x + (to.x - from.x) * ratio,
        from.y + (to.y - from.y) * ratio,
        from.z + (to.z - from.z) * ratio
      )
      const position = new Vec3(Math.floor(point.x), Math.floor(point.y), Math.floor(point.z))
      if (ignoredPosition &&
        position.x === ignoredPosition.x &&
        position.y === ignoredPosition.y &&
        position.z === ignoredPosition.z) continue

      const block = this.bot.blockAt(position)
      if (block?.boundingBox === 'block') return false
    }

    return true
  }

  _hasNearbyLavaForPortal() {
    const localSources = this._findLocalLavaSources(PORTAL_FRAME_OFFSETS.length)
    if (localSources.length >= PORTAL_FRAME_OFFSETS.length) return true
    if (localSources.length > 0) this._rejectLavaSources(localSources, 'not enough source blocks for bucket portal')
    return false
  }

  _shouldMoveToSeenLava() {
    const source = this._findSeenLavaSource()
    return Boolean(source) &&
      !this._hasNearbyLavaForPortal() &&
      source.position.distanceTo(this.bot.entity.position) > this.config.portalLavaRadius
  }

  _findLocalLavaSources(count) {
    return this._findLiquidSources('lava', count, this.config.portalLavaRadius)
      .filter(block => !this._isRejectedLavaSource(block))
  }

  _findSeenLavaSource() {
    this._purgeRejectedLavaSources()
    return this._findLiquidSources('lava', 16)
      .filter(block => !this._isRejectedLavaSource(block))
      .sort((a, b) => this._blockScore(a) - this._blockScore(b))[0] ?? null
  }

  _rejectLocalLavaSources(reason) {
    const localSources = this._findLiquidSources('lava', PORTAL_FRAME_OFFSETS.length, this.config.portalLavaRadius)
    if (localSources.length > 0 && localSources.length < PORTAL_FRAME_OFFSETS.length) {
      this._rejectLavaSources(localSources, reason)
    }
  }

  _rejectLavaSources(sources, reason) {
    const expiresAt = Date.now() + this.config.rejectedLavaTtlMs

    for (const source of sources) {
      this.rejectedLavaSources.set(this._blockKey(source), expiresAt)
    }

    this._log(`Reject lava pocket (${sources.length}/${PORTAL_FRAME_OFFSETS.length} sources): ${reason}.`, { level: 'warn' })
  }

  _isRejectedLavaSource(block) {
    const key = this._blockKey(block)
    const expiresAt = this.rejectedLavaSources.get(key)
    if (!expiresAt) return false
    if (expiresAt > Date.now()) return true
    this.rejectedLavaSources.delete(key)
    return false
  }

  _purgeRejectedLavaSources() {
    const now = Date.now()
    for (const [key, expiresAt] of this.rejectedLavaSources) {
      if (expiresAt <= now) this.rejectedLavaSources.delete(key)
    }
  }

  _nextLiquidSearchTarget(name) {
    const current = this.bot.entity.position.floored()
    let search = this.liquidSearches.get(name)

    if (!search) {
      search = { origin: current, index: 0 }
      this.liquidSearches.set(name, search)
    }

    const direction = LIQUID_SEARCH_DIRECTIONS[search.index % LIQUID_SEARCH_DIRECTIONS.length]
    const ring = 1 + Math.floor(search.index / LIQUID_SEARCH_DIRECTIONS.length)
    search.index += 1

    const step = Math.max(16, this.config.liquidSearchStepBlocks)
    const target = search.origin.offset(direction[0] * ring * step, 0, direction[1] * ring * step)
    return this._walkableSearchTargetNear(target) ?? target
  }

  _walkableSearchTargetNear(target) {
    const x = Math.floor(target.x)
    const z = Math.floor(target.z)
    const startY = Math.floor(this.bot.entity.position.y)

    for (let dy = 4; dy >= -8; dy--) {
      const foot = new Vec3(x, startY + dy, z)
      const ground = this.bot.blockAt(foot.offset(0, -1, 0))
      const body = this.bot.blockAt(foot)
      const head = this.bot.blockAt(foot.offset(0, 1, 0))

      if (ground?.boundingBox === 'block' && this._isClearBlock(body) && this._isClearBlock(head)) {
        return foot
      }
    }

    return null
  }

  _isSourceLiquid(block, name) {
    if (!block || block.name !== name) return false
    const level = block.getProperties?.().level
    return level === undefined ? (block.metadata ?? 0) === 0 : Number(level) === 0
  }

  _placementReferenceFor(position) {
    for (const face of PLACEMENT_FACES) {
      const reference = this.bot.blockAt(position.minus(face))
      if (reference?.boundingBox === 'block') {
        return { block: reference, face }
      }
    }

    return null
  }

  _findFillerItem() {
    return this._findFirstItem(FILLER_BLOCK_NAMES)
  }

  _fillerBlockCount() {
    return this._count(FILLER_BLOCK_NAMES)
  }

  _isClearBlock(block) {
    return block?.boundingBox === 'empty' &&
      block.name !== 'water' &&
      block.name !== 'lava' &&
      block.name !== 'fire' &&
      block.name !== 'nether_portal'
  }

  _blockNameAt(position) {
    return this.bot.blockAt(position)?.name ?? 'unknown'
  }

  async _moveNearPosition(position, range) {
    if (position.distanceTo(this.bot.entity.position) <= range) return
    await this.bot.pathfinder.goto(new goals.GoalNear(position.x, position.y, position.z, range))
  }

  _inNether() {
    const dimension = this.bot.game?.dimension ?? this.bot.game?.dimensionName ?? ''
    return String(dimension).toLowerCase().includes('nether')
  }

  async _craftStoneSword() {
    if (!this._has('stone_sword')) await this._craftItem('stone_sword', 1, true)
    await this._equipBestWeapon()
  }

  async _craftBucketRoute() {
    if (!this._has('bucket')) await this._craftItem('bucket', 1, true)
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

  async _equipBestPickaxe() {
    const pickaxe = this._findFirstItem(PICKAXE_PRIORITY)
    if (pickaxe) await this.bot.equip(pickaxe, 'hand').catch(() => { })
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

  _netherEntryStatus() {
    if (this._inNether()) return 'Goal met: entered the Nether.'
    if (this._findNearbyPortalBlock()) return 'Nether portal lit; waiting to enter.'
    if (this._hasPortalFrameComplete()) return 'Nether portal frame built; ignition still pending.'
    return 'Nether entry not complete yet.'
  }
}

export { SpeedrunBot as MinecraftBot }
