import { INCIDENT_RESOLUTION } from '../config/monitoring.js';
import { Alert } from '../models/Alert.js';
import { CheckResult } from '../models/CheckResult.js';
import { Incident } from '../models/Incident.js';
import { Monitor } from '../models/Monitor.js';
import { resolveTarget } from '../security/targetPolicy.js';
import { AppError } from '../utils/AppError.js';
import { closeOpenIncident } from './incidentService.js';
import { freshMonitorState } from './monitorState.js';
import { getMonitorUptime, getUptime24hByMonitor } from './statsService.js';

async function findMonitorOrThrow(monitorId) {
  const monitor = await Monitor.findById(monitorId);
  if (!monitor) throw new AppError(404, 'MONITOR_NOT_FOUND', 'Monitor not found.');
  return monitor;
}

export async function listMonitors() {
  const monitors = await Monitor.find().sort({ createdAt: -1 }).limit(500);
  const uptimeByMonitor = await getUptime24hByMonitor(monitors.map((monitor) => monitor._id));
  return monitors.map((monitor) => ({
    ...monitor.toJSON(),
    uptime24h: uptimeByMonitor.get(monitor.id),
  }));
}

export async function createMonitor({ name, url, paused = false }) {
  const target = await resolveTarget(url);
  const monitor = await Monitor.create({ name, url: target.url.href, paused });
  return monitor.toJSON();
}

export async function getMonitor(monitorId) {
  const monitor = await findMonitorOrThrow(monitorId);
  return { ...monitor.toJSON(), uptime: await getMonitorUptime(monitor._id) };
}

export async function updateMonitor(monitorId, changes) {
  const current = await findMonitorOrThrow(monitorId);
  const updates = { ...changes };

  const urlChanged = changes.url !== undefined;
  if (urlChanged) updates.url = (await resolveTarget(changes.url)).url.href;

  // Streaks and statuses describe what was observed about one target while it was
  // being watched. After a URL change or a pause, that knowledge no longer applies.
  const pausedChanged = changes.paused !== undefined && changes.paused !== current.paused;
  const targetChanged = urlChanged && updates.url !== current.url;
  const shouldReset = pausedChanged || targetChanged;

  const now = new Date();
  if (shouldReset) Object.assign(updates, freshMonitorState(now));

  const monitor = await Monitor.findOneAndUpdate(
    { _id: monitorId },
    { $set: updates },
    { returnDocument: 'after', runValidators: true },
  );
  if (!monitor) throw new AppError(404, 'MONITOR_NOT_FOUND', 'Monitor not found.');

  // Close after saving: the save has already fenced off any in-flight check, so that
  // check cannot reopen the incident. MONITOR_RESET means no recovery was observed.
  if (shouldReset) {
    await closeOpenIncident(monitor._id, { endedAt: now, resolution: INCIDENT_RESOLUTION.MONITOR_RESET });
  }
  return monitor.toJSON();
}

export async function deleteMonitor(monitorId) {
  const monitor = await Monitor.findByIdAndDelete(monitorId);
  if (!monitor) throw new AppError(404, 'MONITOR_NOT_FOUND', 'Monitor not found.');
  await Promise.all([
    CheckResult.deleteMany({ monitor: monitor._id }),
    Incident.deleteMany({ monitor: monitor._id }),
    Alert.deleteMany({ monitor: monitor._id }),
  ]);
}

export async function listChecks(monitorId, { limit, before, since }) {
  await findMonitorOrThrow(monitorId);

  const checkedAt = {};
  if (before) checkedAt.$lt = before;
  if (since) checkedAt.$gte = since;
  const filter = { monitor: monitorId, ...(before || since ? { checkedAt } : {}) };

  const checks = await CheckResult.find(filter).sort({ checkedAt: -1 }).limit(limit);
  return {
    checks: checks.map((check) => check.toJSON()),
    // Pass this back as `before` to load the next page.
    nextBefore: checks.length === limit ? checks.at(-1).checkedAt : null,
  };
}

export async function listIncidents(monitorId, { limit, status }) {
  await findMonitorOrThrow(monitorId);
  const incidents = await Incident.find({ monitor: monitorId, ...(status ? { status } : {}) })
    .sort({ startedAt: -1 })
    .limit(limit);
  return incidents.map((incident) => incident.toJSON());
}
