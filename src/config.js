export const config = {
  host: process.env.MINECRAFT_HOST ?? 'localhost',
  port: Number.parseInt(process.env.MINECRAFT_PORT ?? '25565', 10),
  username: process.env.MINECRAFT_USERNAME ?? 'MilestoneBot',
  auth: process.env.MINECRAFT_AUTH ?? 'offline',
  version: process.env.MINECRAFT_VERSION || undefined,
  autoStart: process.env.MILESTONE_AUTOSTART !== 'false',
  collectionRadius: Number.parseInt(process.env.COLLECTION_RADIUS ?? '128', 10),
  viewerPort: Number.parseInt(process.env.VIEWER_PORT ?? '3007', 10),
  targets: {
    logs: Number.parseInt(process.env.TARGET_LOGS ?? '12', 10),
    cobblestone: Number.parseInt(process.env.TARGET_COBBLESTONE ?? '24', 10),
    rawIron: Number.parseInt(process.env.TARGET_RAW_IRON ?? '6', 10),
    food: Number.parseInt(process.env.TARGET_FOOD ?? '4', 10)
  }
}
