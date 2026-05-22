import { logger } from "./logger.js";
import { Supervisor } from "./harness/supervisor.js";
import { HARNESS } from "./harness/config.js";

logger.info("=== Minecraft Speedrun Harness ===");
logger.info(`Runtime: ${process.version} on ${process.platform}`);
logger.info(`Server JVM: ${HARNESS.javaBin}`);
logger.info(`Dashboard: http://localhost:${HARNESS.dashboardPort}  |  3D view: http://localhost:${HARNESS.viewerPort}`);
logger.info(`Idle — start a run from the Monitor tab or run scenarios from the Tests tab.`);

const supervisor = new Supervisor();
supervisor.run().catch((err) => {
  logger.error(`Supervisor crashed: ${err?.stack ?? err}`);
  process.exit(1);
});
