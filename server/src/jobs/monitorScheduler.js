import cron from 'node-cron';
import { isDatabaseConnected } from '../config/db.js';
import { SCHEDULER_CRON } from '../config/monitoring.js';
import { checkRunner } from '../services/checkRunner.js';
import { logger } from '../utils/logger.js';

// The cron job is only a heartbeat. What is due, and who owns it, lives in MongoDB,
// so a restart loses nothing and several workers can run this at the same time.
export function startMonitorScheduler({ runner = checkRunner } = {}) {
  return cron.schedule(
    SCHEDULER_CRON,
    async () => {
      if (!isDatabaseConnected()) return;
      try {
        await runner.runDueChecks();
      } catch (error) {
        logger.error('Scheduler tick failed', { error: error.message });
      }
    },
    { name: 'monitor-checks', noOverlap: true },
  );
}
