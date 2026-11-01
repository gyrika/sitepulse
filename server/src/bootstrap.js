import { createApp } from './app.js';
import { config } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { startAlertScheduler } from './jobs/alertScheduler.js';
import { startMonitorScheduler } from './jobs/monitorScheduler.js';
import { alertDispatcher } from './services/alertDispatcher.js';
import { checkRunner } from './services/checkRunner.js';
import { logger } from './utils/logger.js';

const defaults = {
  connect: () => connectDatabase(config.mongodbUri),
  disconnect: disconnectDatabase,
  startScheduler: startMonitorScheduler,
  startAlerts: startAlertScheduler,
  drainChecks: () => checkRunner.drain(),
  drainAlerts: () => alertDispatcher.drain(),
  listen: () =>
    new Promise((resolve, reject) => {
      const server = createApp().listen(config.port, config.host, (error) => {
        if (error) reject(error);
        else resolve(server);
      });
    }),
};

/**
 * Starts everything in dependency order. The scheduler only starts after MongoDB is
 * connected and indexes exist; if connecting fails, this rejects and nothing else runs.
 */
export async function startApplication(overrides = {}) {
  const deps = { ...defaults, ...overrides };

  await deps.connect();
  logger.info('Connected to MongoDB');

  const scheduler = deps.startScheduler();
  logger.info('Monitoring scheduler started');
  const alertScheduler = deps.startAlerts();

  const server = await deps.listen();
  logger.info('API listening', { host: config.host, port: config.port });

  return async function shutdown() {
    await scheduler.destroy();
    await alertScheduler.destroy();
    await new Promise((resolve) => server.close(resolve));
    await deps.drainChecks();
    await deps.drainAlerts();
    await deps.disconnect();
    logger.info('Shutdown complete');
  };
}
