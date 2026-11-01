import { startApplication } from './bootstrap.js';
import { logger } from './utils/logger.js';

try {
  const shutdown = await startApplication();

  let stopping = false;
  const stop = async (signal) => {
    if (stopping) return;
    stopping = true;
    logger.info('Shutting down', { signal });
    try {
      await shutdown();
      process.exit(0);
    } catch (error) {
      logger.error('Shutdown failed', { error: error.message });
      process.exit(1);
    }
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch (error) {
  logger.error('Startup failed', { error: error.message });
  process.exit(1);
}
