import { describe, expect, it } from 'vitest';
import { buildChartRows, findFailureRuns, niceTicks, summarizeChecks } from '../src/lib/chartData.js';
import {
  describeFailure,
  formatCoverage,
  formatDuration,
  formatRelativeTime,
  formatUptime,
  hostOf,
} from '../src/lib/format.js';

const MINUTE = 60_000;
const at = (minutes) => new Date(Date.UTC(2026, 0, 1) + minutes * MINUTE).toISOString();
const ok = (minutes, ms = 100) => ({ id: `${minutes}`, checkedAt: at(minutes), success: true, responseTimeMs: ms, httpStatus: 200 });
const failed = (minutes, overrides = {}) => ({ id: `${minutes}`, checkedAt: at(minutes), success: false, responseTimeMs: null, httpStatus: null, errorCode: 'TIMEOUT', ...overrides });

describe('buildChartRows', () => {
  it('sorts the newest-first API response into time order', () => {
    const rows = buildChartRows([ok(2), ok(1), ok(0)]);
    expect(rows.map((row) => row.check.checkedAt)).toEqual([at(0), at(1), at(2)]);
  });

  it('keeps a failed check off the response-time line, even with a response time', () => {
    const [row] = buildChartRows([failed(0, { httpStatus: 503, responseTimeMs: 1500 })]);
    expect(row.responseTimeMs).toBeNull();
    expect(row.failedMarker).toBe(0);
  });

  it('breaks the line where no checks ran instead of drawing across', () => {
    const rows = buildChartRows([ok(0), ok(1), ok(60), ok(61)]);
    expect(rows).toHaveLength(5);
    expect(rows[2]).toMatchObject({ responseTimeMs: null, check: null });
  });

  it('does not break the line for ordinary timing jitter', () => {
    expect(buildChartRows([ok(0), ok(1), ok(2)])).toHaveLength(3);
  });

  it('marks a success with no neighbours so it can draw a dot', () => {
    const rows = buildChartRows([ok(0), failed(1), ok(2), ok(3)]);
    expect(rows.map((row) => row.isolated)).toEqual([true, false, false, false]);
  });

  it('marks a lone check as isolated', () => {
    expect(buildChartRows([ok(0)])[0].isolated).toBe(true);
  });
});

describe('findFailureRuns', () => {
  const runsOf = (checks) => findFailureRuns(buildChartRows(checks));
  const time = (minutes) => new Date(at(minutes)).getTime();

  it('groups consecutive failures into one span covering the whole outage', () => {
    expect(runsOf([ok(0), failed(1), failed(2), failed(3), ok(4)])).toEqual([{ from: time(1), to: time(3) }]);
  });

  it('keeps separate outages separate', () => {
    expect(runsOf([failed(0), failed(1), ok(2), failed(3), failed(4)])).toHaveLength(2);
  });

  it('includes an outage still running at the end of the data', () => {
    expect(runsOf([ok(0), failed(1), failed(2)])).toEqual([{ from: time(1), to: time(2) }]);
  });

  it('leaves a single failure to its own marker', () => {
    const rows = buildChartRows([ok(0), failed(1), ok(2)]);
    expect(findFailureRuns(rows)).toEqual([]);
    expect(rows[1].failedDot).toBe(true);
  });

  it('marks only the last check of a run, so a short outage stays visible', () => {
    const rows = buildChartRows([ok(0), failed(1), failed(2), failed(3), ok(4)]);
    expect(rows.map((row) => row.failedDot)).toEqual([false, false, false, true, false]);
  });

  it('does not treat monitoring gaps as part of an outage', () => {
    expect(runsOf([failed(0), failed(1), failed(60), failed(61)])).toHaveLength(2);
  });
});

describe('niceTicks', () => {
  it.each([
    [380, [0, 100, 200, 300, 400]],
    [146, [0, 50, 100, 150]],
    [1500, [0, 500, 1000, 1500]],
    [0, [0, 100]],
  ])('uses round values for a maximum of %i', (max, expected) => {
    expect(niceTicks(max)).toEqual(expected);
  });

  it('always reaches the highest value', () => {
    for (const max of [7, 99, 101, 999, 12345]) {
      expect(niceTicks(max).at(-1)).toBeGreaterThanOrEqual(max);
    }
  });
});

describe('summarizeChecks', () => {
  it('averages only successful checks', () => {
    expect(summarizeChecks([ok(0, 100), ok(1, 200), failed(2, { responseTimeMs: 9000, httpStatus: 503 })])).toEqual({ total: 3, failed: 1, averageMs: 150 });
  });

  it('has no average without a successful check', () => {
    expect(summarizeChecks([failed(0)]).averageMs).toBeNull();
  });
});

describe('formatting', () => {
  it('never turns missing uptime into a number', () => {
    expect(formatUptime({ uptimePercent: null })).toBe('Not enough data');
    expect(formatUptime(undefined)).toBe('Not enough data');
    expect(formatUptime({ uptimePercent: 0 })).toBe('0%');
    expect(formatUptime({ uptimePercent: 99.912 })).toBe('99.912%');
  });

  it('does not round small coverage down to nothing', () => {
    expect(formatCoverage({ coveragePercent: 0.02 })).toBe('Under 0.1% monitored');
    expect(formatCoverage({ coveragePercent: 0 })).toBe('0.0% monitored');
    expect(formatCoverage({ coveragePercent: 62.5 })).toBe('62.5% monitored');
  });

  it.each([
    [10_000, 'Just now'],
    [5 * MINUTE, '5 min ago'],
    [3 * 60 * MINUTE, '3 hr ago'],
    [2 * 24 * 60 * MINUTE, '2 d ago'],
  ])('describes %i ms ago as %s', (elapsed, expected) => {
    const now = Date.UTC(2026, 0, 2);
    expect(formatRelativeTime(new Date(now - elapsed), now)).toBe(expected);
  });

  it('describes a monitor never checked', () => {
    expect(formatRelativeTime(null)).toBe('Never');
  });

  it.each([
    [10_000, 'Under a minute'],
    [12 * MINUTE, '12m'],
    [60 * MINUTE, '1h'],
    [(24 * 60 + 90) * MINUTE, '1d 1h 30m'],
  ])('formats a duration of %i ms as %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  it('describes failures', () => {
    expect(describeFailure({ httpStatus: 503, errorCode: 'HTTP_STATUS' })).toBe('HTTP 503');
    expect(describeFailure({ httpStatus: null, errorCode: 'TIMEOUT' })).toBe('Timed out');
    expect(describeFailure({ httpStatus: null, errorCode: 'NEW_CODE' })).toBe('Failed');
  });

  it('reads the host from a URL', () => {
    expect(hostOf('https://example.com:8443/a?b=1')).toBe('example.com:8443');
    expect(hostOf('not a url')).toBe('not a url');
  });
});
