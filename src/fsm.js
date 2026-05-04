import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { Vec3 } = require('vec3')

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ─── Constants ───────────────────────────────────────────────────────────────

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

// Pathfinder/collectblock errors that mean "block unreachable" — skip, don't abort
const SKIP_PATTERNS = ['No path', 'Timeout', 'Took to long', 'Digging aborted', 'pathfinder', 'aborted']
const isSkippable = err => SKIP_PATTERNS.some(p => (err?.message ?? String(err)).includes(p))

// ─── FSM ─────────────────────────────────────────────────────────────────────

export class MilestoneOneFSM {
  constructor (bot, config) {
    this.bot = bot
    this.config = config
    this.state = 'IDLE'
    this.running = false
  }

  transition (next, reason = '') {
    if (next === this.state) return
    const note = reason ? ` (${reason})` : ''
    console.log(`[FSM] ${this.state} → ${next}${note}`)
    this.state = next
  }

  stop () { this.running = false }

  async run () {
    this.running = true
    while (this.running && this.state !== 'DONE') {
      const handler = this[`state_${this.state}`]
      if (!handler) {
        console.error(`[FSM] No handler for state "${this.state}", resetting to IDLE.`)
        this.state = 'IDLE'
        continue
      }
      try {
        await handler.call(this)
      } catch (err) {
        console.warn(`[FSM] Unhandled error in ${this.state}: ${err.message} — returning to IDLE`)
        await sleep(2000)
        this.transition('IDLE')
      }
    }
    if (this.state === 'DONE') {
      const msg = this._netherReadiness()
      console.log('[FSM]', msg)
      this.bot.chat(msg)
    }
  }

  // ─── States ─────────────────────────────────────────────────────────────────

  /**
   * Hub state. Waits for combat, then inspects inventory to decide the next
   * concrete task. By always returning here after any action or error, the bot
   * self-heals: if it died, lost items, or was interrupted, the next IDLE pass
   * will re-derive what is still missing and continue from there.
   */
  async state_IDLE () {
    while (this.bot.pvp.target) await sleep(500)
    await sleep(200) // let inventory settle after pickups

    const logs    = this._count(LOG_NAMES)
    const cobble  = this._count(COBBLE_NAMES)
    const rawIron = this._count(RAW_IRON_NAMES)
    const ingots  = this._count(['iron_ingot'])

    if (logs < this.config.targets.logs) {
      this.transition('COLLECT_LOGS', `${logs}/${this.config.targets.logs}`)
    } else if (!this._has('wooden_pickaxe')) {
      this.transition('CRAFT_BASICS')
    } else if (cobble < this.config.targets.cobblestone) {
      this.transition('COLLECT_COBBLESTONE', `${cobble}/${this.config.targets.cobblestone}`)
    } else if (!this._has('stone_pickaxe') || !this._has('stone_sword')) {
      this.transition('CRAFT_STONE_TOOLS')
    } else if (rawIron < this.config.targets.rawIron) {
      this.transition('COLLECT_IRON', `${rawIron}/${this.config.targets.rawIron}`)
    } else if (ingots < 3) {
      this.transition('SMELT_IRON')
    } else if (!this._has('iron_pickaxe') && !this._has('bucket')) {
      this.transition('CRAFT_IRON_GEAR')
    } else {
      this.transition('DONE')
    }
  }

  async state_COLLECT_LOGS () {
    await this._collectUntil(LOG_NAMES, LOG_NAMES, this.config.targets.logs, 'logs')
    this.transition('IDLE', 'logs done')
  }

  async state_CRAFT_BASICS () {
    await this._ensurePlanks(24)
    if (this._count(['stick']) < 4) await this._craftItem('stick', 1, false)
    if (!this._has('crafting_table'))  await this._craftItem('crafting_table', 1, false)
    if (!this._has('wooden_pickaxe'))  await this._craftItem('wooden_pickaxe', 1, true)
    this.transition('IDLE', 'basics done')
  }

  async state_COLLECT_COBBLESTONE () {
    await this._collectUntil(STONE_BLOCK_NAMES, COBBLE_NAMES, this.config.targets.cobblestone, 'cobblestone')
    this.transition('IDLE', 'cobblestone done')
  }

  async state_CRAFT_STONE_TOOLS () {
    if (this._count(['stick']) < 4) await this._craftItem('stick', 1, false)
    if (!this._has('stone_pickaxe')) await this._craftItem('stone_pickaxe', 1, true)
    if (!this._has('stone_sword'))   await this._craftItem('stone_sword', 1, true)
    await this._equipBestWeapon()
    this.transition('IDLE', 'stone tools done')
  }

  async state_COLLECT_IRON () {
    await this._collectUntil(IRON_ORE_NAMES, RAW_IRON_NAMES, this.config.targets.rawIron, 'iron ore')
    this.transition('IDLE', 'iron done')
  }

  async state_SMELT_IRON () {
    await this._smeltIron()
    this.transition('IDLE', 'smelting done')
  }

  async state_CRAFT_IRON_GEAR () {
    await this._craftIfCan('iron_pickaxe', true)
    await this._craftIfCan('bucket', true)
    for (const piece of ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots']) {
      await this._craftIfCan(piece, true)
    }
    await this._equipArmor()
    await this._equipBestWeapon()
    this.transition('IDLE', 'iron gear done')
  }

  // ─── Collection ──────────────────────────────────────────────────────────────

  /**
   * Collects blocks one at a time. Unreachable blocks are recorded in a skip
   * set and excluded from subsequent searches within the same pass. After three
   * passes with no reachable blocks the state throws so IDLE can re-evaluate
   * (the bot may have been teleported, died, or the area may be exhausted).
   */
  async _collectUntil (blockNames, itemNames, target, label) {
    const skipped = new Set()
    let emptyRounds = 0

    while (this.running && this._count(itemNames) < target) {
      while (this.bot.pvp.target) await sleep(500)

      const have = this._count(itemNames)
      const want = target - have
      const all    = this._findBlocks(blockNames, Math.min(want + skipped.size, 24))
      const blocks = all.filter(b => !skipped.has(b.position.toString()))

      if (blocks.length === 0) {
        emptyRounds++
        if (emptyRounds > 3) {
          throw new Error(`No reachable ${label} within ${this.config.collectionRadius} blocks.`)
        }
        console.warn(`[FSM] No reachable ${label}, clearing skip list and retrying… (${emptyRounds}/3)`)
        skipped.clear()
        await sleep(3000)
        continue
      }
      emptyRounds = 0

      for (const block of blocks) {
        if (!this.running || this._count(itemNames) >= target) break
        while (this.bot.pvp.target) await sleep(500)
        try {
          await this.bot.collectBlock.collect(block, { ignoreNoPath: true })
        } catch (err) {
          if (isSkippable(err)) {
            skipped.add(block.position.toString())
            console.warn(`[FSM] Skip ${label} at ${block.position}: ${err.message}`)
          } else {
            throw err
          }
        }
      }
    }
  }

  // ─── Crafting ────────────────────────────────────────────────────────────────

  async _ensurePlanks (target) {
    while (this._count(PLANK_NAMES) < target) {
      const pair = WOOD_PAIRS.find(([log]) => this._count([log]) > 0)
      if (!pair) throw new Error('No logs available to craft planks.')
      await this._craftItem(pair[1], 1, false)
    }
  }

  async _craftItem (name, times, needsTable) {
    const reg = this.bot.registry.itemsByName[name]
    if (!reg) throw new Error(`Unknown item: ${name}`)
    const table  = needsTable ? await this._findOrPlace('crafting_table') : null
    const recipe = this.bot.recipesFor(reg.id, null, 1, table)[0]
    if (!recipe) throw new Error(`No recipe for ${name} with current inventory.`)
    console.log(`[FSM] Crafting ${name}`)
    await this.bot.craft(recipe, times, table)
  }

  async _craftIfCan (name, needsTable) {
    if (this._has(name)) return
    try {
      await this._craftItem(name, 1, needsTable)
    } catch {
      console.log(`[FSM] Cannot craft ${name} yet, skipping.`)
    }
  }

  /**
   * Finds a placed block nearby, or crafts and places one from inventory.
   * Scans a 5×5 column at three Y offsets to handle sloped terrain.
   */
  async _findOrPlace (blockName) {
    const id = this.bot.registry.blocksByName[blockName]?.id
    if (!id) throw new Error(`Unknown block: ${blockName}`)

    const existing = this.bot.findBlock({ matching: id, maxDistance: 6 })
    if (existing) return existing

    if (!this._has(blockName)) await this._craftItem(blockName, 1, false)
    const item = this._findItem(blockName)
    if (!item) throw new Error(`No ${blockName} in inventory.`)

    await this.bot.equip(item, 'hand')
    const surface = this._placementSurface()
    if (!surface) throw new Error(`No flat surface nearby to place ${blockName}.`)

    await this.bot.placeBlock(surface, new Vec3(0, 1, 0))
    await sleep(300)

    const placed = this.bot.findBlock({ matching: id, maxDistance: 6 })
    if (!placed) throw new Error(`Placed ${blockName} but could not locate it.`)
    return placed
  }

  _placementSurface () {
    const o = this.bot.entity.position.floored()
    for (let dy = 0; dy >= -2; dy--) {
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          if (dx === 0 && dz === 0) continue
          const ref = this.bot.blockAt(o.offset(dx, dy - 1, dz))
          const tgt = this.bot.blockAt(o.offset(dx, dy,     dz))
          const top = this.bot.blockAt(o.offset(dx, dy + 1, dz))
          if (
            ref?.boundingBox === 'block' &&
            tgt?.boundingBox === 'empty' &&
            top?.boundingBox === 'empty'
          ) return ref
        }
      }
    }
    return null
  }

  async _smeltIron () {
    const input = this._findFirstItem(RAW_IRON_NAMES)
    if (!input) { console.warn('[FSM] No iron to smelt.'); return }

    if (!this._has('furnace')) await this._craftItem('furnace', 1, true)
    const furnaceBlock = await this._findOrPlace('furnace')
    const fuel = this._findFirstItem(FUEL_NAMES)
    if (!fuel) throw new Error('No fuel available for furnace.')

    const count  = input.count
    const before = this._count(['iron_ingot'])
    const furnace = await this.bot.openFurnace(furnaceBlock)
    try {
      await furnace.putInput(input.type, null, count)
      await furnace.putFuel(fuel.type, null, Math.max(1, Math.min(fuel.count, count + 2)))
      const deadline = Date.now() + count * 11_000 + 5_000
      while (Date.now() < deadline && this._count(['iron_ingot']) < before + count) {
        if (furnace.outputItem()) await furnace.takeOutput()
        await sleep(1000)
      }
      if (furnace.outputItem()) await furnace.takeOutput()
    } finally {
      furnace.close()
    }
  }

  // ─── Equipment ───────────────────────────────────────────────────────────────

  async _equipBestWeapon () {
    const w = this._findFirstItem(WEAPON_PRIORITY)
    if (w) await this.bot.equip(w, 'hand').catch(() => {})
  }

  async _equipArmor () {
    for (const [name, slot] of ARMOR_SLOTS) {
      const item = this._findItem(name)
      if (item) await this.bot.equip(item, slot).catch(() => {})
    }
  }

  // ─── Inventory helpers ───────────────────────────────────────────────────────

  _count (names) {
    return this.bot.inventory.items()
      .filter(i => names.includes(i.name))
      .reduce((s, i) => s + i.count, 0)
  }

  _has (name) {
    return this.bot.inventory.items().some(i => i.name === name)
  }

  _findItem (name) {
    return this.bot.inventory.items().find(i => i.name === name)
  }

  _findFirstItem (names) {
    return names.map(n => this._findItem(n)).find(Boolean)
  }

  _findBlocks (names, count) {
    const ids = names.map(n => this.bot.registry.blocksByName[n]?.id).filter(Boolean)
    if (!ids.length) return []
    return this.bot.findBlocks({ matching: ids, maxDistance: this.config.collectionRadius, count })
      .map(pos => this.bot.blockAt(pos)).filter(Boolean)
  }

  _netherReadiness () {
    if (this._has('diamond_pickaxe')) return 'Milestone 1 complete: diamond pickaxe Nether route ready.'
    if (this._has('bucket'))          return 'Milestone 1 complete: bucket portal route ready.'
    return 'Milestone 1 done: core gear crafted; Nether prep still needs a bucket or diamond pickaxe.'
  }
}
