export const config = {
  host: process.env.MINECRAFT_HOST ?? 'localhost',
  port: Number.parseInt(process.env.MINECRAFT_PORT ?? '25565', 10),
  username: process.env.MINECRAFT_USERNAME ?? 'MinecraftBot',
  auth: process.env.MINECRAFT_AUTH ?? 'offline',
  version: process.env.MINECRAFT_VERSION || undefined,
  autoStart: process.env.BOT_AUTOSTART !== 'false',
  collectionRadius: Number.parseInt(process.env.COLLECTION_RADIUS ?? '128', 10),
  plannerTickMs: Number.parseInt(process.env.PLANNER_TICK_MS ?? '75', 10),
  actionTimeoutMs: Number.parseInt(process.env.ACTION_TIMEOUT_MS ?? '3000', 10),
  collectBlockTimeoutMs: Number.parseInt(process.env.COLLECT_BLOCK_TIMEOUT_MS ?? '3000', 10),
  craftingTimeoutMs: Number.parseInt(process.env.CRAFTING_TIMEOUT_MS ?? '7000', 10),
  craftingStepTimeoutMs: Number.parseInt(process.env.CRAFTING_STEP_TIMEOUT_MS ?? '4000', 10),
  smeltingTimeoutMs: Number.parseInt(process.env.SMELTING_TIMEOUT_MS ?? '90000', 10),
  pathfinderTimeoutMs: Number.parseInt(process.env.PATHFINDER_TIMEOUT_MS ?? '2500', 10),
  pathfinderTickTimeoutMs: Number.parseInt(process.env.PATHFINDER_TICK_TIMEOUT_MS ?? '35', 10),
  collectBatchSize: Number.parseInt(process.env.COLLECT_BATCH_SIZE ?? '2', 10),
  dropPickupRadius: Number.parseInt(process.env.DROP_PICKUP_RADIUS ?? '6', 10),
  dropPickupTimeoutMs: Number.parseInt(process.env.DROP_PICKUP_TIMEOUT_MS ?? '1500', 10),
  skipBlockTtlMs: Number.parseInt(process.env.SKIP_BLOCK_TTL_MS ?? '20000', 10),
  targets: {
    logs: Number.parseInt(process.env.TARGET_LOGS ?? '3', 10),
    cobblestone: Number.parseInt(process.env.TARGET_COBBLESTONE ?? '24', 10),
    rawIron: Number.parseInt(process.env.TARGET_RAW_IRON ?? '6', 10),
    food: Number.parseInt(process.env.TARGET_FOOD ?? '4', 10)
  }
}
