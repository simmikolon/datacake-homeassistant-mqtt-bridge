import "./utils/loadEnv";

import { childLogger, logger } from "./utils/logger";
import { configService } from "./config/configService";
import { bootstrapFromSupervisorIfNeeded } from "./config/supervisorBootstrap";
import { getDb, closeDb } from "./db/database";
import { orchestrator } from "./runtime/bridgeOrchestrator";
import { startHttpServer } from "./ui/webServer";

const log = childLogger("main");

async function main(): Promise<void> {
  getDb();
  configService.load();

  // When running as a Home Assistant add-on, auto-fill the HA MQTT broker
  // details from the Supervisor's services/mqtt API on first boot. Must run
  // after the DB is open (configService persists via SQLite) but before the
  // orchestrator so the very first MQTT connection already uses the HA broker.
  await bootstrapFromSupervisorIfNeeded();

  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  await startHttpServer(Number.isFinite(port) ? port : 3000);

  await orchestrator.start();

  const shutdown = async (signal: string) => {
    log.info({ signal }, "Shutting down");
    try {
      await orchestrator.stop();
    } catch (err) {
      log.error({ err }, "Error during orchestrator stop");
    }
    try {
      closeDb();
    } catch (err) {
      log.error({ err }, "Error closing database");
    }
    // Give the pino transport a brief moment to flush buffered log lines.
    setTimeout(() => process.exit(0), 200);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, "Uncaught exception");
});

main().catch((err) => {
  logger.error({ err }, "Fatal error during boot");
  process.exit(1);
});
