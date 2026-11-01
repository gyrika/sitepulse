import { randomUUID } from 'node:crypto';
import { config } from '../config/env.js';
import {
  CHECK_INTERVAL_MS,
  CHECK_SOURCE,
  LOCK_LEASE_TIMEOUT_MULTIPLIER,
} from '../config/monitoring.js';
import { CheckResult } from '../models/CheckResult.js';
import { Monitor } from '../models/Monitor.js';
import { logger } from '../utils/logger.js';
import { syncIncidentWithStatus } from './incidentService.js';
import { nextMonitorState } from './monitorState.js';

function lockFields(now) {
  return {
    lockToken: randomUUID(),
    lockedUntil: new Date(now.getTime() + config.checkTimeoutMs * LOCK_LEASE_TIMEOUT_MULTIPLIER),
    nextCheckAt: new Date(now.getTime() + CHECK_INTERVAL_MS),
  };
}

const notLocked = (now) => ({ $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] });

/**
 * Atomically takes ownership of one due monitor. findOneAndUpdate is a single atomic
 * operation in MongoDB, so when several workers race, exactly one gets each monitor.
 * If a worker crashes, its lease expires and another worker picks the monitor up.
 */
export function claimDueMonitor(now = new Date()) {
  return Monitor.findOneAndUpdate(
    { paused: false, nextCheckAt: { $lte: now }, ...notLocked(now) },
    { $set: lockFields(now) },
    { sort: { nextCheckAt: 1 }, returnDocument: 'after' },
  );
}

// A manual check takes the same lock, so it can never overlap a scheduled one.
export function claimMonitorById(monitorId, now = new Date()) {
  return Monitor.findOneAndUpdate(
    { _id: monitorId, paused: false, ...notLocked(now) },
    { $set: lockFields(now) },
    { returnDocument: 'after' },
  );
}

/**
 * Saves a finished check. The update only matches while we still hold our lock token
 * (a "fencing token"). If the lease expired, or an admin paused, edited or deleted the
 * monitor during the check, the update matches nothing and the stale result is dropped.
 */
export async function recordCheckOutcome(claimed, outcome, { checkedAt, source = CHECK_SOURCE.SCHEDULED }) {
  const { next, transition, statusChanged } = nextMonitorState(claimed, {
    success: outcome.success,
    checkedAt,
  });

  const monitor = await Monitor.findOneAndUpdate(
    { _id: claimed._id, lockToken: claimed.lockToken },
    {
      $set: {
        ...next,
        ...(statusChanged ? { lastStatusChangeAt: checkedAt } : {}),
        lastCheckedAt: checkedAt,
        lastResponseTimeMs: outcome.responseTimeMs,
        lastHttpStatus: outcome.httpStatus,
        lastErrorCode: outcome.errorCode,
        lockToken: null,
        lockedUntil: null,
      },
    },
    { returnDocument: 'after' },
  );

  if (!monitor) return { applied: false };

  const check = await CheckResult.create({ monitor: monitor._id, checkedAt, source, ...outcome });
  await syncIncidentWithStatus(monitor, {
    checkedAt,
    errorCode: outcome.errorCode,
    httpStatus: outcome.httpStatus,
  });

  if (transition) {
    logger.info('Monitor state transition', { monitorId: monitor.id, transition });
  }

  return { applied: true, monitor, check, transition };
}
