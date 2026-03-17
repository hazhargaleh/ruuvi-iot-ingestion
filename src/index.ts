import { startHttpServer } from "./http/healthServer.js";
import { startMqtt } from "./mqtt/mqttService.js";
import { logger } from "./logger/logger.js";
import { initMariaSchema } from './maria-db/mariaDbService.js';
async function main() {
  await initMariaSchema();
  await startHttpServer();
  startMqtt();
  logger.info("Ruuvi ingestion service started");
}
main();
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
async function shutdown() {
  logger.info("Shutting down service...");
  process.exit(0);
}