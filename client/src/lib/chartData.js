// A missing check is more than a late one once this many intervals pass with nothing.
const CHECK_INTERVAL_MS = 60_000;
const GAP_THRESHOLD_MS = CHECK_INTERVAL_MS * 2.5;

export const CHART_RANGES = [
  { key: '1h', label: '1 hour', ms: 60 * 60 * 1000 },
  { key: '6h', label: '6 hours', ms: 6 * 60 * 60 * 1000 },
  { key: '24h', label: '24 hours', ms: 24 * 60 * 60 * 1000 },
];

/**
 * Turns checks into chart rows. Three rules keep the chart honest:
 *
 * - Only successful checks draw the line. A failed check has no meaningful speed.
 * - Time with no checks becomes a break in the line, so an unmonitored hour never looks
 *   like a steady hour. A plain line would draw straight across it.
 * - A success with no neighbours gets its own dot, because a line needs two points.
 */
export function buildChartRows(checks) {
  const sorted = [...checks].sort((a, b) => new Date(a.checkedAt) - new Date(b.checkedAt));
  const rows = [];

  sorted.forEach((check, index) => {
    const time = new Date(check.checkedAt).getTime();
    const previous = sorted[index - 1];
    if (previous && time - new Date(previous.checkedAt).getTime() > GAP_THRESHOLD_MS) {
      rows.push({ time: time - 1, responseTimeMs: null, failedMarker: null, check: null });
    }
    rows.push({
      time,
      responseTimeMs: check.success ? check.responseTimeMs : null,
      // Failures sit on the baseline. Their real detail is in the tooltip and table.
      failedMarker: check.success ? null : 0,
      check,
    });
  });

  const hasNoNeighbour = (key, index) =>
    (rows[index - 1]?.[key] ?? null) === null && (rows[index + 1]?.[key] ?? null) === null;

  return rows.map((row, index) => ({
    ...row,
    isolated: row.responseTimeMs !== null && hasNoNeighbour('responseTimeMs', index),
    // The last check of each failure run gets a dot, so a short outage stays visible
    // at 24-hour scale, where a few minutes of failures is about one pixel wide.
    failedDot: row.failedMarker !== null && (rows[index + 1]?.failedMarker ?? null) === null,
  }));
}

/**
 * Spans of two or more failed checks in a row. Drawn as bands, because at 24-hour scale
 * a 30-minute outage is only a few pixels wide and separate markers would overlap into
 * what looks like a single failure.
 */
export function findFailureRuns(rows) {
  const runs = [];
  let current = null;
  for (const row of rows) {
    if (row.failedMarker !== null) {
      if (current) current.to = row.time;
      else current = { from: row.time, to: row.time };
    } else if (current) {
      if (current.to > current.from) runs.push(current);
      current = null;
    }
  }
  if (current && current.to > current.from) runs.push(current);
  return runs;
}

// Round y-axis values (0, 100, 200...), stepping by 1, 2 or 5 times a power of ten.
export function niceTicks(maxValue, targetIntervals = 4) {
  if (!maxValue || maxValue <= 0) return [0, 100];
  const roughStep = maxValue / targetIntervals;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const step = [1, 2, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= roughStep);
  const ticks = [];
  for (let value = 0; value < maxValue + step; value += step) ticks.push(value);
  return ticks;
}

export function summarizeChecks(checks) {
  const timed = checks.filter((check) => check.success && check.responseTimeMs !== null);
  const failed = checks.filter((check) => !check.success).length;
  const average = timed.length
    ? Math.round(timed.reduce((sum, check) => sum + check.responseTimeMs, 0) / timed.length)
    : null;
  return { total: checks.length, failed, averageMs: average };
}
