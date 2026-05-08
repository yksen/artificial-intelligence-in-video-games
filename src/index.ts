import { logger } from "./logger.js";
import { MinecraftBot } from "./bot.js";

logger.info("=== Minecraft Bot Starting ===");
logger.info(`Node/Bun version: ${process.version}`);
logger.info(`Platform: ${process.platform}`);

try {
  new MinecraftBot();
} catch (err) {
  logger.error(`Failed to create bot: ${err}`);
  process.exit(1);
}

process.on("uncaughtException", (err) => {
  logger.error(`Uncaught exception: ${err.message}`);
  logger.error(err.stack ?? "");
});

process.on("unhandledRejection", (reason) => {
  logger.error(`Unhandled rejection: ${reason}`);
});
