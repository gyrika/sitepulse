import { config } from '../config/env.js';
import { Incident } from '../models/Incident.js';
import { Monitor } from '../models/Monitor.js';
import { logger } from '../utils/logger.js';
import { buildAlertMessage } from './alertMessage.js';
import {
  claimDueAlert,
  markAlertAttemptFailed,
  markAlertCancelled,
  markAlertSent,
} from './alertService.js';
import { sendAlertEmail } from './mailer.js';

/**
 * Sends queued alerts, separately from checks, so a slow mail server never delays
 * monitoring. Delivery is at least once: if a worker crashes after the mail server
 * accepted a message but before saving that, the alert is sent again after its lease
 * expires. The fixed Message-ID lets mail systems recognize that repeat.
 */
export class AlertDispatcher {
  constructor({ send = sendAlertEmail, dashboardUrl = config.alerts.dashboardUrl } = {}) {
    this.send = send;
    this.dashboardUrl = dashboardUrl;
    this.stopped = false;
    this.running = null;
  }

  async deliver(alert) {
    const [monitor, incident] = await Promise.all([
      Monitor.findById(alert.monitor),
      Incident.findById(alert.incident),
    ]);
    if (!monitor || !incident) {
      // The monitor was deleted after this alert was queued.
      await markAlertCancelled(alert);
      return;
    }

    try {
      await this.send({
        ...buildAlertMessage({ alert, monitor, incident, dashboardUrl: this.dashboardUrl }),
        messageId: `<alert-${alert.id}@sitepulse.alerts>`,
      });
    } catch (error) {
      const gaveUp = await markAlertAttemptFailed(alert, error);
      const meta = { alertId: alert.id, monitorId: monitor.id, attempts: alert.attempts, error: error.message };
      if (gaveUp) logger.error('Alert could not be delivered, giving up', meta);
      else logger.warn('Alert delivery failed, will retry', meta);
      return;
    }

    await markAlertSent(alert);
    logger.info('Alert sent', { alertId: alert.id, monitorId: monitor.id, type: alert.type });
  }

  // Sends one at a time until nothing is due. Any number of workers can run this.
  async runDueAlerts() {
    this.running = (async () => {
      while (!this.stopped) {
        const alert = await claimDueAlert();
        if (!alert) return;
        await this.deliver(alert);
      }
    })();
    return this.running;
  }

  // Finishes the email being sent so a shutdown does not cut it off. The rest stay queued.
  async drain() {
    this.stopped = true;
    await Promise.allSettled([this.running]);
  }
}

export const alertDispatcher = new AlertDispatcher();
