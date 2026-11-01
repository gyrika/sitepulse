import { randomUUID } from 'node:crypto';
import { config } from '../config/env.js';
import {
  ALERT_FAILURE_VISIBLE_DAYS,
  ALERT_LEASE_MS,
  ALERT_RETRY_DELAYS_MS,
  ALERT_STATUS,
  ALERT_TYPE,
} from '../config/monitoring.js';
import { Alert } from '../models/Alert.js';
import { DUPLICATE_KEY_ERROR } from '../utils/mongoErrors.js';

const MAX_ERROR_LENGTH = 500;
const DELIVERY_PROBLEM_LIMIT = 5;
const DAY_MS = 24 * 60 * 60_000;

/**
 * Alerts the admin has not received: those waiting for a retry, and recent ones that ran
 * out of retries. Retries are included because giving up takes hours, and a broken mail
 * server should be visible long before that.
 */
export async function getAlertDeliveryProblems(now = new Date()) {
  const retrying = { status: ALERT_STATUS.PENDING, lastError: { $ne: null } };
  const failed = {
    status: ALERT_STATUS.FAILED,
    updatedAt: { $gte: new Date(now.getTime() - ALERT_FAILURE_VISIBLE_DAYS * DAY_MS) },
  };

  const [retryingCount, failedCount, recent] = await Promise.all([
    Alert.countDocuments(retrying),
    Alert.countDocuments(failed),
    Alert.find({ $or: [retrying, failed] })
      .sort({ updatedAt: -1 })
      .limit(DELIVERY_PROBLEM_LIMIT)
      .populate('monitor', 'name url'),
  ]);

  return { retrying: retryingCount, failed: failedCount, recent: recent.map((alert) => alert.toJSON()) };
}

/**
 * Queues an alert. It is safe to repeat: the unique index allows one alert of each type
 * per incident, so the repair pass that runs after every check can call this freely.
 * With email off nothing is queued, so turning it on later does not send a backlog.
 */
export async function enqueueAlert({ incident, type, occurredAt, now = new Date() }) {
  if (!config.alerts.enabled) return;
  try {
    await Alert.updateOne(
      { incident: incident._id, type },
      { $setOnInsert: { monitor: incident.monitor, occurredAt, nextAttemptAt: now } },
      { upsert: true },
    );
  } catch (error) {
    // Another writer queued it first, which is exactly the outcome we wanted.
    if (error.code !== DUPLICATE_KEY_ERROR) throw error;
  }
}

// Once an outage is over, "it is down" is no longer true. A recovery email still reports
// the outage, and after a pause or URL change the admin already knows.
export function cancelPendingDownAlerts(monitorId) {
  return Alert.updateMany(
    { monitor: monitorId, type: ALERT_TYPE.DOWN, status: ALERT_STATUS.PENDING },
    { $set: { status: ALERT_STATUS.CANCELLED } },
  );
}

// Same pattern as claiming a monitor: atomic, with a lease that outlives a crashed worker.
export function claimDueAlert(now = new Date()) {
  return Alert.findOneAndUpdate(
    {
      status: ALERT_STATUS.PENDING,
      nextAttemptAt: { $lte: now },
      $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }],
    },
    {
      $set: { lockToken: randomUUID(), lockedUntil: new Date(now.getTime() + ALERT_LEASE_MS) },
      $inc: { attempts: 1 },
    },
    { sort: { nextAttemptAt: 1, createdAt: 1 }, returnDocument: 'after' },
  );
}

export function markAlertSent(claimed, now = new Date()) {
  return Alert.updateOne(
    { _id: claimed._id, lockToken: claimed.lockToken },
    { $set: { status: ALERT_STATUS.SENT, sentAt: now, lastError: null, lockToken: null, lockedUntil: null } },
  );
}

export function markAlertCancelled(claimed) {
  return Alert.updateOne(
    { _id: claimed._id, lockToken: claimed.lockToken },
    { $set: { status: ALERT_STATUS.CANCELLED, lockToken: null, lockedUntil: null } },
  );
}

// Schedules a retry, or gives up once the delays run out. Returns true when it gave up.
export async function markAlertAttemptFailed(claimed, error, now = new Date()) {
  const delay = ALERT_RETRY_DELAYS_MS[claimed.attempts - 1];
  const gaveUp = delay === undefined;
  await Alert.updateOne(
    // Matching PENDING keeps an alert cancelled during the attempt from coming back.
    { _id: claimed._id, lockToken: claimed.lockToken, status: ALERT_STATUS.PENDING },
    {
      $set: {
        ...(gaveUp
          ? { status: ALERT_STATUS.FAILED }
          : { nextAttemptAt: new Date(now.getTime() + delay) }),
        lastError: String(error.message).slice(0, MAX_ERROR_LENGTH),
        lockToken: null,
        lockedUntil: null,
      },
    },
  );
  return gaveUp;
}
