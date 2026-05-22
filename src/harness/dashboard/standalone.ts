import { HARNESS } from "../config.js";
import { Recorder } from "../events.js";
import { logger } from "../../logger.js";
import { Dashboard } from "./server.js";
import { TestRunner } from "./testRunner.js";

const recorder = new Recorder(HARNESS.runsRoot, `dashboard-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const testRunner = new TestRunner();
const dashboard = new Dashboard(recorder, {}, testRunner);
dashboard.start();

logger.info("=== Scenario Test Dashboard ===");
logger.info(`Open: http://localhost:${HARNESS.dashboardPort}  →  "Tests" tab`);
logger.info(`Concurrency: ${testRunner.concurrency} (set TEST_DASHBOARD_PARALLEL to change)`);

function shutdown(): void {
  try {
    dashboard.stop();
    recorder.close();
  } finally {
    process.exit(0);
  }
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
