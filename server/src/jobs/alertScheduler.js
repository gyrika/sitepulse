import cron from 'node-cron';
import { isDatabaseConnected } from '../config/db.js';
import { config } from '../config/env.js';
import { ALERT_CRON } from '../config/monitoring.js';
import { alertDispatcher } from '../services/alertDispatcher.js';
import { logger } from '../utils/logger.js';

export function startAlertScheduler({ dispatcher = alertDispatcher, enabled = config.alerts.enabled } = {}) {
  if (!enabled) {
    logger.warn('Email alerts are off because SMTP_HOST is not set');
    return { destroy: async () => {} };
  }

  logger.info('Alert scheduler started');
  return cron.schedule(
    ALERT_CRON,
    async () => {
      if (!isDatabaseConnected()) return;
      try {
        await dispatcher.runDueAlerts();
      } catch (error) {
        logger.error('Alert scheduler tick failed', { error: error.message });
      }
    },
    { name: 'alert-delivery', noOverlap: true },
  );
}
