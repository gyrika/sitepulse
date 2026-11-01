import { SMTPServer } from 'smtp-server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config/env.js';
import {
  ALERT_LEASE_MS,
  ALERT_RETRY_DELAYS_MS,
  ALERT_STATUS,
  ALERT_TYPE,
  CHECK_ERROR,
} from '../src/config/monitoring.js';
import { Alert } from '../src/models/Alert.js';
import { Incident } from '../src/models/Incident.js';
import { Monitor } from '../src/models/Monitor.js';
import { AlertDispatcher } from '../src/services/alertDispatcher.js';
import { buildAlertMessage } from '../src/services/alertMessage.js';
import { claimDueAlert, enqueueAlert } from '../src/services/alertService.js';
import { claimMonitorById, recordCheckOutcome } from '../src/services/checkService.js';
import { ensureOpenIncident, syncIncidentWithStatus } from '../src/services/incidentService.js';
import { createMailer } from '../src/services/mailer.js';
import { deleteMonitor, updateMonitor } from '../src/services/monitorService.js';
import { useTestDatabase } from './helpers/db.js';

useTestDatabase();

const up = { success: true, httpStatus: 200, responseTimeMs: 42, errorCode: null, errorMessage: null, bodyTruncated: false };
const down = { success: false, httpStatus: 503, responseTimeMs: 40, errorCode: CHECK_ERROR.HTTP_STATUS, errorMessage: 'HTTP 503', bodyTruncated: false };

let urlCounter = 0;
const createMonitor = (fields = {}) => {
  urlCounter += 1;
  return Monitor.create({ name: `Alert site ${urlCounter}`, url: `https://alert${urlCounter}.example.com/`, ...fields });
};

async function runCycles(monitor, outcome, count) {
  for (let i = 0; i < count; i += 1) {
    const claimed = await claimMonitorById(monitor._id);
    await recordCheckOutcome(claimed, outcome, { checkedAt: new Date() });
  }
}

const alertTypes = async (monitor) =>
  (await Alert.find({ monitor: monitor._id }).sort({ createdAt: 1 })).map((alert) => alert.type);

const later = (ms) => new Date(Date.now() + ms);

describe('queueing alerts', () => {
  afterEach(() => {
    config.alerts.enabled = true;
  });

  it('queues nothing until the third failure, then one DOWN alert', async () => {
    const monitor = await createMonitor();
    await runCycles(monitor, down, 2);
    expect(await alertTypes(monitor)).toEqual([]);

    await runCycles(monitor, down, 1);
    expect(await alertTypes(monitor)).toEqual([ALERT_TYPE.DOWN]);
  });

  it('does not queue another alert while the site stays down', async () => {
    const monitor = await createMonitor();
    await runCycles(monitor, down, 8);
    expect(await alertTypes(monitor)).toEqual([ALERT_TYPE.DOWN]);
  });

  it('queues one alert when many writers race', async () => {
    const monitor = await createMonitor();
    const incident = await ensureOpenIncident(monitor._id, { startedAt: new Date(), errorCode: null, httpStatus: 500 });
    await Promise.all(
      Array.from({ length: 20 }, () => enqueueAlert({ incident, type: ALERT_TYPE.DOWN, occurredAt: new Date() })),
    );
    expect(await Alert.countDocuments()).toBe(1);
  });

  it('queues one RECOVERED alert after the second success', async () => {
    const monitor = await createMonitor();
    await runCycles(monitor, down, 3);
    await runCycles(monitor, up, 1);
    expect(await alertTypes(monitor)).toEqual([ALERT_TYPE.DOWN]);

    await runCycles(monitor, up, 5);
    expect(await alertTypes(monitor)).toEqual([ALERT_TYPE.DOWN, ALERT_TYPE.RECOVERED]);
  });

  it('does not treat a new monitor coming up as a recovery', async () => {
    const monitor = await createMonitor();
    await runCycles(monitor, up, 3);
    expect(await Alert.countDocuments()).toBe(0);
  });

  it('alerts again for a second, separate outage', async () => {
    const monitor = await createMonitor();
    await runCycles(monitor, down, 3);
    await runCycles(monitor, up, 2);
    await runCycles(monitor, down, 3);
    expect(await alertTypes(monitor)).toEqual([ALERT_TYPE.DOWN, ALERT_TYPE.RECOVERED, ALERT_TYPE.DOWN]);
  });

  it('repairs a DOWN alert lost to a crash on the next check', async () => {
    const monitor = await createMonitor();
    await runCycles(monitor, down, 3);
    await Alert.deleteMany({});

    await runCycles(monitor, down, 1);
    expect(await alertTypes(monitor)).toEqual([ALERT_TYPE.DOWN]);
  });

  it('repairs a recovery interrupted by a crash, without a second email', async () => {
    const monitor = await createMonitor();
    await runCycles(monitor, down, 3);
    await runCycles(monitor, up, 2);

    // As if the worker crashed after queueing the alert but before closing the incident.
    await Incident.updateOne({ monitor: monitor._id }, { status: 'OPEN', endedAt: null, resolution: null });
    const current = await Monitor.findById(monitor._id);
    await syncIncidentWithStatus(current, { checkedAt: new Date(), errorCode: null, httpStatus: 200 });

    expect(await alertTypes(monitor)).toEqual([ALERT_TYPE.DOWN, ALERT_TYPE.RECOVERED]);
    expect(await Incident.countDocuments({ monitor: monitor._id, status: 'OPEN' })).toBe(0);
  });

  it('sends no recovery alert when the admin pauses a down monitor, and drops the unsent DOWN', async () => {
    const monitor = await createMonitor();
    await runCycles(monitor, down, 3);

    await updateMonitor(monitor.id, { paused: true });

    const alerts = await Alert.find({ monitor: monitor._id });
    expect(alerts.map((alert) => [alert.type, alert.status])).toEqual([[ALERT_TYPE.DOWN, ALERT_STATUS.CANCELLED]]);
  });

  it('cancels an unsent DOWN alert once the site recovers', async () => {
    const monitor = await createMonitor();
    await runCycles(monitor, down, 3);
    await runCycles(monitor, up, 2);

    const downAlert = await Alert.findOne({ monitor: monitor._id, type: ALERT_TYPE.DOWN });
    const recovered = await Alert.findOne({ monitor: monitor._id, type: ALERT_TYPE.RECOVERED });
    expect(downAlert.status).toBe(ALERT_STATUS.CANCELLED);
    expect(recovered.status).toBe(ALERT_STATUS.PENDING);
  });

  it('deletes alerts along with their monitor', async () => {
    const monitor = await createMonitor();
    await runCycles(monitor, down, 3);
    await deleteMonitor(monitor.id);
    expect(await Alert.countDocuments()).toBe(0);
  });

  it('queues nothing while email is off, and monitoring still works', async () => {
    config.alerts.enabled = false;
    const monitor = await createMonitor();
    await runCycles(monitor, down, 3);

    expect(await Alert.countDocuments()).toBe(0);
    expect(await Incident.countDocuments({ monitor: monitor._id, status: 'OPEN' })).toBe(1);
  });
});

describe('delivering alerts', () => {
  const downMonitor = async () => {
    const monitor = await createMonitor();
    await runCycles(monitor, down, 3);
    return monitor;
  };

  it('sends a queued alert once and marks it sent', async () => {
    const monitor = await downMonitor();
    const send = vi.fn().mockResolvedValue({});
    const dispatcher = new AlertDispatcher({ send });

    await dispatcher.runDueAlerts();
    await dispatcher.runDueAlerts();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].subject).toBe(`[SitePulse] DOWN: ${monitor.name}`);
    const alert = await Alert.findOne({ monitor: monitor._id });
    expect(alert.status).toBe(ALERT_STATUS.SENT);
    expect(alert.sentAt).toBeInstanceOf(Date);
    expect(send.mock.calls[0][0].messageId).toBe(`<alert-${alert.id}@sitepulse.alerts>`);
  });

  it('sends one email when many workers race', async () => {
    await downMonitor();
    const send = vi.fn().mockResolvedValue({});
    const workers = Array.from({ length: 10 }, () => new AlertDispatcher({ send }));

    await Promise.all(workers.map((worker) => worker.runDueAlerts()));

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('retries a failed send after a delay, keeping the error', async () => {
    const monitor = await downMonitor();
    const send = vi.fn().mockRejectedValue(new Error('mail server unavailable'));
    const before = Date.now();

    await new AlertDispatcher({ send }).runDueAlerts();

    expect(send).toHaveBeenCalledTimes(1);
    const alert = await Alert.findOne({ monitor: monitor._id });
    expect(alert).toMatchObject({ status: ALERT_STATUS.PENDING, attempts: 1, lastError: 'mail server unavailable', lockToken: null });
    expect(alert.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before + ALERT_RETRY_DELAYS_MS[0]);
  });

  it('gives up after the last retry and does not stop other alerts', async () => {
    const monitor = await downMonitor();
    // Due first, so it is the one that hits the failing send below.
    await Alert.updateOne({ monitor: monitor._id }, { attempts: ALERT_RETRY_DELAYS_MS.length, nextAttemptAt: later(-5000) });
    const other = await downMonitor();

    const send = vi.fn().mockRejectedValueOnce(new Error('still down')).mockResolvedValue({});
    await new AlertDispatcher({ send }).runDueAlerts();

    expect(await Alert.findOne({ monitor: monitor._id })).toMatchObject({ status: ALERT_STATUS.FAILED, lastError: 'still down' });
    expect((await Alert.findOne({ monitor: other._id })).status).toBe(ALERT_STATUS.SENT);
  });

  it('lets another worker take over after a crashed worker\'s lease expires', async () => {
    await downMonitor();
    const first = await claimDueAlert();
    expect(await claimDueAlert()).toBeNull();

    const second = await claimDueAlert(later(ALERT_LEASE_MS + 1000));

    expect(second.id).toBe(first.id);
    expect(second.lockToken).not.toBe(first.lockToken);
    expect(second.attempts).toBe(2);
  });

  it('keeps an alert cancelled when its send fails after the outage ended', async () => {
    const monitor = await downMonitor();
    const send = vi.fn(async () => {
      await runCycles(monitor, up, 2);
      throw new Error('too late anyway');
    });

    await new AlertDispatcher({ send }).runDueAlerts();

    const downAlert = await Alert.findOne({ monitor: monitor._id, type: ALERT_TYPE.DOWN });
    expect(downAlert.status).toBe(ALERT_STATUS.CANCELLED);
  });

  it('does not email about a monitor deleted after queueing', async () => {
    const monitor = await downMonitor();
    await Monitor.deleteOne({ _id: monitor._id });
    const send = vi.fn();

    await new AlertDispatcher({ send }).runDueAlerts();

    expect(send).not.toHaveBeenCalled();
    expect((await Alert.findOne({ monitor: monitor._id })).status).toBe(ALERT_STATUS.CANCELLED);
  });

  it('stops after the current email when draining', async () => {
    await downMonitor();
    await downMonitor();
    const dispatcher = new AlertDispatcher({ send: vi.fn().mockResolvedValue({}) });
    const send = vi.fn(async () => {
      dispatcher.stopped = true;
    });
    dispatcher.send = send;

    await dispatcher.runDueAlerts();
    await dispatcher.drain();

    expect(send).toHaveBeenCalledTimes(1);
    expect(await Alert.countDocuments({ status: ALERT_STATUS.PENDING })).toBe(1);
  });
});

describe('the email', () => {
  const startedAt = new Date('2026-01-01T10:00:00Z');
  const monitor = { _id: 'abc123', name: 'Shop', url: 'https://shop.example.com/health?token=secret-value' };
  const incident = { startedAt, httpStatus: 503, errorCode: CHECK_ERROR.HTTP_STATUS };

  const build = (alert, overrides = {}) =>
    buildAlertMessage({ alert, monitor, incident, dashboardUrl: 'https://status.example.com/', ...overrides });

  it('describes an outage and links to the monitor', () => {
    const { subject, text } = build({ type: ALERT_TYPE.DOWN, occurredAt: startedAt });
    expect(subject).toBe('[SitePulse] DOWN: Shop');
    expect(text).toContain('Shop (shop.example.com) is down.');
    expect(text).toContain('Thu, 01 Jan 2026 10:00:00 GMT');
    expect(text).toContain('HTTP 503');
    expect(text).toContain('https://status.example.com/monitors/abc123');
  });

  it('reports how long a recovered outage lasted', () => {
    const occurredAt = new Date('2026-01-01T11:35:00Z');
    const { subject, text } = build({ type: ALERT_TYPE.RECOVERED, occurredAt });
    expect(subject).toBe('[SitePulse] RECOVERED: Shop');
    expect(text).toContain('1 h 35 min');
  });

  it('describes a failure that has no HTTP status', () => {
    const { text } = build(
      { type: ALERT_TYPE.DOWN, occurredAt: startedAt },
      { incident: { startedAt, httpStatus: null, errorCode: CHECK_ERROR.DNS_ERROR } },
    );
    expect(text).toContain('DNS lookup failed');
  });

  it('never includes the URL path or query, which can hold secrets', () => {
    for (const type of Object.values(ALERT_TYPE)) {
      const { subject, text } = build({ type, occurredAt: startedAt });
      expect(`${subject}${text}`).not.toContain('secret-value');
      expect(`${subject}${text}`).not.toContain('/health');
    }
  });

  it('cannot have headers injected through a monitor name', () => {
    const { subject } = build(
      { type: ALERT_TYPE.DOWN, occurredAt: startedAt },
      { monitor: { ...monitor, name: 'Shop\r\nBcc: attacker@example.com' } },
    );
    expect(subject).toBe('[SitePulse] DOWN: Shop Bcc: attacker@example.com');
  });

  it('leaves the link out when no dashboard URL is set', () => {
    const { text } = build({ type: ALERT_TYPE.DOWN, occurredAt: startedAt }, { dashboardUrl: undefined });
    expect(text).not.toContain('Details:');
  });
});

describe('sending through a real SMTP server', () => {
  it('delivers a DOWN alert over SMTP', async () => {
    const received = [];
    const server = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      onData(stream, session, callback) {
        let raw = '';
        stream.on('data', (chunk) => {
          raw += chunk;
        });
        stream.on('end', () => {
          received.push({ raw, to: session.envelope.rcptTo.map((rcpt) => rcpt.address) });
          callback();
        });
      },
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    try {
      const monitor = await createMonitor({ name: 'Real SMTP site' });
      await runCycles(monitor, down, 3);

      const send = createMailer({
        smtpHost: '127.0.0.1',
        smtpPort: server.server.address().port,
        smtpSecurity: 'none',
        from: 'sitepulse@example.test',
        to: ['admin@example.test'],
      });
      await new AlertDispatcher({ send }).runDueAlerts();

      expect(received).toHaveLength(1);
      expect(received[0].to).toEqual(['admin@example.test']);
      expect(received[0].raw).toContain('Subject: [SitePulse] DOWN: Real SMTP site');
      expect((await Alert.findOne({ monitor: monitor._id })).status).toBe(ALERT_STATUS.SENT);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
