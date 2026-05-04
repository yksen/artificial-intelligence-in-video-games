import { createRequire } from 'node:module'
import { loader as autoEat } from 'mineflayer-auto-eat'
import { config } from './config.js'
import { MilestoneOneFSM } from './fsm.js'

const require = createRequire(import.meta.url)
const mineflayer       = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const collectBlock     = require('mineflayer-collectblock').plugin
const pvp              = require('mineflayer-pvp').plugin
const mineflayerViewer = require('prismarine-viewer').mineflayer

const HOSTILE_MOBS = new Set([
  'zombie', 'skeleton', 'spider', 'creeper', 'witch',
  'drowned', 'husk', 'stray', 'slime', 'phantom',
])

// ─── Bot setup ───────────────────────────────────────────────────────────────

const bot = mineflayer.createBot({
  host: config.host,
  port: config.port,
  username: config.username,
  auth: config.auth,
  version: config.version,
})

let fsm = null

bot.loadPlugin(pathfinder)
bot.loadPlugin(collectBlock)
bot.loadPlugin(pvp)

bot.once('spawn', () => {
  const movements = new Movements(bot)
  movements.canDig      = true
  movements.allowParkour = false
  bot.pathfinder.thinkTimeout  = 8000
  bot.pathfinder.searchRadius  = config.collectionRadius
  bot.pathfinder.setMovements(movements)
  bot.collectBlock.movements = movements

  bot.loadPlugin(autoEat)
  bot.autoEat.setOpts({
    priority:    'foodPoints',
    minHunger:   16,
    minHealth:   14,
    bannedFood:  ['rotten_flesh', 'pufferfish', 'chorus_fruit', 'poisonous_potato', 'spider_eye'],
  })
  bot.autoEat.enableAuto()

  mineflayerViewer(bot, { port: config.viewerPort, firstPerson: true })

  console.log(`Connected as ${bot.username} on ${config.host}:${config.port}`)
  console.log(`Viewer: http://localhost:${config.viewerPort}`)

  // Passive defense: attack the nearest hostile on every physics tick.
  // mineflayer-pvp takes over pathfinding while fighting; when the mob dies
  // the FSM's collectUntil loop wakes from its `pvp.target` wait and continues.
  bot.on('physicsTick', () => {
    if (!fsm?.running) return
    const threat = bot.nearestEntity(
      e => e !== bot.entity &&
           e.type === 'mob' &&
           HOSTILE_MOBS.has(e.name) &&
           e.position.distanceTo(bot.entity.position) <= 6
    )
    if (threat) bot.pvp.attack(threat).catch(() => {})
  })

  if (config.autoStart) {
    sleep(3000).then(startFSM)
  } else {
    console.log('Auto-start disabled. Type "start" in chat to begin.')
  }
})

// ─── Chat commands ───────────────────────────────────────────────────────────

bot.on('chat', (username, message) => {
  if (username === bot.username) return
  const cmd = message.trim().toLowerCase()

  if (cmd === 'start') startFSM()

  if (cmd === 'stop') {
    fsm?.stop()
    bot.collectBlock.cancelTask().catch(() => {})
    bot.pathfinder.setGoal(null)
    bot.pvp.stop().catch(() => {})
    bot.chat('Stopped.')
  }

  if (cmd === 'status') {
    bot.chat(fsm ? `State: ${fsm.state}` : 'Not running.')
  }

  if (cmd === 'come') {
    const target = bot.players[username]?.entity
    if (!target) { bot.chat("I can't see you."); return }
    const { x, y, z } = target.position
    bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, 1))
  }
})

// ─── Lifecycle ───────────────────────────────────────────────────────────────

bot.on('error', err => console.error('Bot error:', err.message))
bot.on('kicked', reason => console.error('Kicked:', JSON.stringify(reason)))
bot.on('end', () => { console.log('Disconnected.'); fsm?.stop() })

// ─── Helpers ─────────────────────────────────────────────────────────────────

function startFSM () {
  if (fsm?.running) { bot.chat('Already running.'); return }
  fsm = new MilestoneOneFSM(bot, config)
  fsm.run().catch(err => {
    console.error('[FSM] Fatal:', err.message)
    bot.chat(`Milestone stopped: ${err.message}`)
  })
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
