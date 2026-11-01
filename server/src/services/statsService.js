import { CHECK_INTERVAL_MS, MIN_UPTIME_COVERAGE } from '../config/monitoring.js';
import { CheckResult } from '../models/CheckResult.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const UPTIME_WINDOWS = Object.freeze({ '24h': DAY_MS, '7d': 7 * DAY_MS, '30d': 30 * DAY_MS });

const roundTo3 = (value) => Math.round(value * 1000) / 1000;

/**
 * Turns raw counts into a stat that only makes claims the data supports.
 *
 * Uptime is successful checks divided by recorded checks, so time nobody was watching
 * is never counted as "up". Coverage says how much of the window those checks span;
 * below the minimum, uptimePercent is null rather than a confident-looking number.
 */
export function summarizeWindow(counts, windowMs, monitorCount = 1) {
  const { totalChecks = 0, successfulChecks = 0, avgResponseTimeMs = null } = counts ?? {};
  const expectedChecks = (windowMs / CHECK_INTERVAL_MS) * monitorCount;
  const coverage = expectedChecks > 0 ? Math.min(totalChecks / expectedChecks, 1) : 0;
  const sufficient = totalChecks > 0 && coverage >= MIN_UPTIME_COVERAGE;

  return {
    status: sufficient ? 'OK' : 'INSUFFICIENT_DATA',
    uptimePercent: sufficient ? roundTo3((successfulChecks / totalChecks) * 100) : null,
    coveragePercent: roundTo3(coverage * 100),
    totalChecks,
    successfulChecks,
    failedChecks: totalChecks - successfulChecks,
    avgResponseTimeMs: avgResponseTimeMs === null ? null : Math.round(avgResponseTimeMs),
  };
}

const countsSince = (from) => [
  { $sum: { $cond: [{ $gte: ['$checkedAt', from] }, 1, 0] } },
  { $sum: { $cond: [{ $and: [{ $gte: ['$checkedAt', from] }, '$success'] }, 1, 0] } },
  // $avg ignores null, so checks without an HTTP response do not affect the average.
  { $avg: { $cond: [{ $gte: ['$checkedAt', from] }, '$responseTimeMs', null] } },
];

// All windows for one monitor, computed in a single pass over the largest window.
export async function getMonitorUptime(monitorId, now = new Date()) {
  const windows = Object.entries(UPTIME_WINDOWS);
  const group = { _id: null };
  windows.forEach(([key, windowMs]) => {
    const [total, successful, average] = countsSince(new Date(now.getTime() - windowMs));
    group[`${key}_total`] = total;
    group[`${key}_successful`] = successful;
    group[`${key}_average`] = average;
  });

  const [row] = await CheckResult.aggregate([
    {
      $match: {
        monitor: monitorId,
        checkedAt: { $gte: new Date(now.getTime() - Math.max(...Object.values(UPTIME_WINDOWS))), $lte: now },
      },
    },
    { $group: group },
  ]);

  return Object.fromEntries(
    windows.map(([key, windowMs]) => [
      key,
      summarizeWindow(
        {
          totalChecks: row?.[`${key}_total`],
          successfulChecks: row?.[`${key}_successful`],
          avgResponseTimeMs: row?.[`${key}_average`] ?? null,
        },
        windowMs,
      ),
    ]),
  );
}

// Grouped 24-hour counts, so the monitor list needs one query rather than one per monitor.
export async function getUptime24hByMonitor(monitorIds, now = new Date()) {
  const rows = await CheckResult.aggregate([
    { $match: { monitor: { $in: monitorIds }, checkedAt: { $gte: new Date(now.getTime() - DAY_MS), $lte: now } } },
    {
      $group: {
        _id: '$monitor',
        totalChecks: { $sum: 1 },
        successfulChecks: { $sum: { $cond: ['$success', 1, 0] } },
        avgResponseTimeMs: { $avg: '$responseTimeMs' },
      },
    },
  ]);

  const countsByMonitor = new Map(rows.map((row) => [row._id.toString(), row]));
  return new Map(
    monitorIds.map((id) => [id.toString(), summarizeWindow(countsByMonitor.get(id.toString()), DAY_MS)]),
  );
}

export async function getOverallUptime24h(activeMonitorCount, now = new Date()) {
  const [row] = await CheckResult.aggregate([
    { $match: { checkedAt: { $gte: new Date(now.getTime() - DAY_MS), $lte: now } } },
    {
      $group: {
        _id: null,
        totalChecks: { $sum: 1 },
        successfulChecks: { $sum: { $cond: ['$success', 1, 0] } },
        avgResponseTimeMs: { $avg: '$responseTimeMs' },
      },
    },
  ]);
  return summarizeWindow(row, DAY_MS, activeMonitorCount);
}
