import { createRequire } from 'node:module'
import { loader as autoEat } from 'mineflayer-auto-eat'
import { config } from './config.js'
import { Bot } from './speedrun.js'

const require = createRequire(import.meta.url)
const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const collectBlock = require('mineflayer-collectblock').plugin
const pvp = require('mineflayer-pvp').plugin

const HOSTILE_MOBS = new Set([
  'zombie', 'skeleton', 'spider', 'creeper', 'witch',
  'drowned', 'husk', 'stray', 'slime', 'phantom',
])

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

  console.log(`[${timestamp()}] Connected as ${bot.username} on ${config.host}:${config.port}`)

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

  startSpeedrun()
})

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
})

bot.on('error', err => console.error(`[${timestamp()}] Bot error:`, err.message))
bot.on('kicked', reason => console.error(`[${timestamp()}] Kicked:`, JSON.stringify(reason)))
bot.on('end', () => { console.log(`[${timestamp()}] Disconnected.`); runner?.stop() })

function startSpeedrun() {
  if (runner?.running) { bot.chat('Already running.'); return }
  runner = new Bot(bot, config)
  runner.run().catch(err => {
    const message = `[${timestamp()}] Fatal: ${err.message}`
    console.error(message)
  })
}

function timestamp() {
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}
