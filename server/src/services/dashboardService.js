import { INCIDENT_STATUS, MONITOR_STATUS } from '../config/monitoring.js';
import { Incident } from '../models/Incident.js';
import { Monitor } from '../models/Monitor.js';
import { getAlertDeliveryProblems } from './alertService.js';
import { getOverallUptime24h } from './statsService.js';

const RECENT_INCIDENT_LIMIT = 5;

export async function getDashboardSummary() {
  const [statusRows, openIncidents, recentIncidents, alertDelivery] = await Promise.all([
    Monitor.aggregate([{ $group: { _id: { status: '$status', paused: '$paused' }, count: { $sum: 1 } } }]),
    Incident.countDocuments({ status: INCIDENT_STATUS.OPEN }),
    Incident.find().sort({ startedAt: -1 }).limit(RECENT_INCIDENT_LIMIT).populate('monitor', 'name url'),
    getAlertDeliveryProblems(),
  ]);

  const monitors = { total: 0, up: 0, down: 0, pending: 0, paused: 0 };
  for (const { _id, count } of statusRows) {
    monitors.total += count;
    if (_id.paused) monitors.paused += count;
    else if (_id.status === MONITOR_STATUS.UP) monitors.up += count;
    else if (_id.status === MONITOR_STATUS.DOWN) monitors.down += count;
    else monitors.pending += count;
  }

  return {
    monitors,
    openIncidents,
    uptime24h: await getOverallUptime24h(monitors.total - monitors.paused),
    recentIncidents: recentIncidents.map((incident) => incident.toJSON()),
    alertDelivery,
  };
}
