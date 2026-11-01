import { ALERT_TYPE, INCIDENT_RESOLUTION, INCIDENT_STATUS, MONITOR_STATUS } from '../config/monitoring.js';
import { Incident } from '../models/Incident.js';
import { DUPLICATE_KEY_ERROR } from '../utils/mongoErrors.js';
import { cancelPendingDownAlerts, enqueueAlert } from './alertService.js';

export async function ensureOpenIncident(monitorId, { startedAt, errorCode, httpStatus }) {
  const open = { monitor: monitorId, status: INCIDENT_STATUS.OPEN };
  try {
    return await Incident.findOneAndUpdate(
      open,
      { $setOnInsert: { startedAt, errorCode, httpStatus } },
      { upsert: true, returnDocument: 'after' },
    );
  } catch (error) {
    // Another writer opened it first, which is exactly the outcome we wanted.
    if (error.code !== DUPLICATE_KEY_ERROR) throw error;
    return Incident.findOne(open);
  }
}

export async function closeOpenIncident(monitorId, { endedAt, resolution }) {
  await cancelPendingDownAlerts(monitorId);
  return Incident.updateOne(
    { monitor: monitorId, status: INCIDENT_STATUS.OPEN },
    { $set: { status: INCIDENT_STATUS.RESOLVED, endedAt, resolution } },
  );
}

/**
 * Makes incidents match the monitor's status. It runs after every check rather than
 * only on a transition, and both operations are safe to repeat. Standalone MongoDB
 * has no multi-document transactions, so if a worker crashes between saving the
 * monitor and saving the incident, the next check repairs the difference.
 */
export async function syncIncidentWithStatus(monitor, { checkedAt, errorCode, httpStatus }) {
  if (monitor.status === MONITOR_STATUS.DOWN) {
    const incident = await ensureOpenIncident(monitor._id, {
      startedAt: monitor.failureStreakStartedAt ?? checkedAt,
      errorCode,
      httpStatus,
    });
    await enqueueAlert({ incident, type: ALERT_TYPE.DOWN, occurredAt: incident.startedAt });
    return;
  }

  const incident = await Incident.findOne({ monitor: monitor._id, status: INCIDENT_STATUS.OPEN });
  if (!incident) return;

  const recovered = monitor.status === MONITOR_STATUS.UP;
  const endedAt = recovered ? (monitor.successStreakStartedAt ?? checkedAt) : checkedAt;

  // Queue before closing: if a crash lands in between, the incident is still open, so the
  // next check repeats both steps and the recovery alert cannot be lost.
  if (recovered) await enqueueAlert({ incident, type: ALERT_TYPE.RECOVERED, occurredAt: endedAt });
  await closeOpenIncident(monitor._id, {
    endedAt,
    resolution: recovered ? INCIDENT_RESOLUTION.RECOVERED : INCIDENT_RESOLUTION.MONITOR_RESET,
  });
}
