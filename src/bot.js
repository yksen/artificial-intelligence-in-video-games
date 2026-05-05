import { createRequire } from 'node:module'
import { loader as autoEat } from 'mineflayer-auto-eat'
import { config } from './config.js'
import { SpeedrunBot } from './speedrun.js'

const require = createRequire(import.meta.url)
const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const collectBlock = require('mineflayer-collectblock').plugin
const pvp = require('mineflayer-pvp').plugin

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

let runner = null

bot.loadPlugin(pathfinder)
bot.loadPlugin(collectBlock)
bot.loadPlugin(pvp)

bot.once('spawn', () => {
  const movements = new Movements(bot)
  movements.allowFreeMotion = true
  bot.pathfinder.thinkTimeout = config.pathfinderTimeoutMs
  bot.pathfinder.tickTimeout = config.pathfinderTickTimeoutMs
  bot.pathfinder.searchRadius = config.collectionRadius
  bot.pathfinder.setMovements(movements)
  bot.collectBlock.movements = movements

  bot.loadPlugin(autoEat)
  bot.autoEat.setOpts({
    priority: 'foodPoints',
    minHunger: 16,
    minHealth: 14,
    bannedFood: ['rotten_flesh', 'pufferfish', 'chorus_fruit', 'poisonous_potato', 'spider_eye'],
  })
  bot.autoEat.enableAuto()

  console.log(`Connected as ${bot.username} on ${config.host}:${config.port}`)

  // Passive defense: let pvp interrupt collection, then the planner resumes.
  bot.on('physicsTick', () => {
    if (!runner?.running) return
    const threat = bot.nearestEntity(
      e => e !== bot.entity &&
        e.type === 'mob' &&
        HOSTILE_MOBS.has(e.name) &&
        e.position.distanceTo(bot.entity.position) <= 6
    )
    if (threat) bot.pvp.attack(threat).catch(() => { })
  })

  if (config.autoStart) {
    sleep(3000).then(startSpeedrun)
  } else {
    console.log('Auto-start disabled. Type "start" in chat to begin.')
  }
})

// ─── Chat commands ───────────────────────────────────────────────────────────

bot.on('chat', (username, message) => {
  if (username === bot.username) return
  const cmd = message.trim().toLowerCase()

  if (cmd === 'start') startSpeedrun()

  if (cmd === 'stop') {
    runner?.stop()
    bot.collectBlock.cancelTask().catch(() => { })
    bot.pathfinder.setGoal(null)
    bot.pvp.stop().catch(() => { })
    bot.chat('Stopped.')
  }

  if (cmd === 'status') {
    bot.chat(runner ? runner.summary() : 'Not running.')
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
bot.on('end', () => { console.log('Disconnected.'); runner?.stop() })

// ─── Helpers ─────────────────────────────────────────────────────────────────

function startSpeedrun() {
  if (runner?.running) { bot.chat('Already running.'); return }
  runner = new SpeedrunBot(bot, config)
  runner.run().catch(err => {
    const message = `[${timestamp()}] Fatal: ${err.message}`
    console.error(message)
  })
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

function timestamp() {
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}
