import { describe, expect, it, vi } from 'vitest';
import { CHECK_ERROR, CHECK_INTERVAL_MS } from '../src/config/monitoring.js';
import { CheckResult } from '../src/models/CheckResult.js';
import { Incident } from '../src/models/Incident.js';
import { Monitor } from '../src/models/Monitor.js';
import { CheckRunner } from '../src/services/checkRunner.js';
import { claimDueMonitor, claimMonitorById, recordCheckOutcome } from '../src/services/checkService.js';
import { ensureOpenIncident } from '../src/services/incidentService.js';
import { updateMonitor } from '../src/services/monitorService.js';
import { useTestDatabase } from './helpers/db.js';

useTestDatabase();

const up = { success: true, httpStatus: 200, responseTimeMs: 42, errorCode: null, errorMessage: null, bodyTruncated: false };
const down = { success: false, httpStatus: 503, responseTimeMs: 40, errorCode: CHECK_ERROR.HTTP_STATUS, errorMessage: 'HTTP 503', bodyTruncated: false };

let urlCounter = 0;
const createDueMonitor = (fields = {}) => {
  urlCounter += 1;
  return Monitor.create({
    name: `Site ${urlCounter}`,
    url: `https://site${urlCounter}.example.com/`,
    nextCheckAt: new Date(Date.now() - 1000),
    ...fields,
  });
};

// One full cycle: claim the monitor, then record an outcome at the given time.
async function runCycle(monitor, outcome, checkedAt = new Date()) {
  const claimed = await claimMonitorById(monitor._id);
  return recordCheckOutcome(claimed, outcome, { checkedAt });
}

describe('claiming', () => {
  it('gives a monitor to exactly one of many racing workers', async () => {
    await createDueMonitor();
    const claims = await Promise.all(Array.from({ length: 20 }, () => claimDueMonitor()));
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it('gives each monitor to one worker when several are due', async () => {
    await Promise.all(Array.from({ length: 5 }, () => createDueMonitor()));
    const claims = (await Promise.all(Array.from({ length: 20 }, () => claimDueMonitor()))).filter(Boolean);
    expect(new Set(claims.map((claim) => claim.id)).size).toBe(5);
    expect(claims).toHaveLength(5);
  });

  it('schedules the next check 60 seconds later', async () => {
    await createDueMonitor();
    const now = new Date();
    const claimed = await claimDueMonitor(now);
    expect(claimed.nextCheckAt.getTime()).toBe(now.getTime() + CHECK_INTERVAL_MS);
  });

  it('skips paused monitors and monitors that are not due', async () => {
    await createDueMonitor({ paused: true });
    await createDueMonitor({ nextCheckAt: new Date(Date.now() + 60_000) });
    expect(await claimDueMonitor()).toBeNull();
  });

  it('lets another worker take over after a crashed worker\'s lease expires', async () => {
    await createDueMonitor();
    const first = await claimDueMonitor();
    expect(await claimDueMonitor()).toBeNull();

    const afterExpiry = new Date(first.nextCheckAt.getTime() + 1000);
    const second = await claimDueMonitor(afterExpiry);

    expect(second.id).toBe(first.id);
    expect(second.lockToken).not.toBe(first.lockToken);
  });

  it('prevents a manual check from overlapping a scheduled one', async () => {
    const monitor = await createDueMonitor();
    await claimDueMonitor();
    expect(await claimMonitorById(monitor._id)).toBeNull();
  });
});

describe('recording results', () => {
  it('saves the check and updates the monitor', async () => {
    const monitor = await createDueMonitor();
    const checkedAt = new Date();

    const result = await runCycle(monitor, up, checkedAt);

    expect(result.applied).toBe(true);
    expect(result.monitor).toMatchObject({ lastHttpStatus: 200, lastResponseTimeMs: 42, lockToken: null, lockedUntil: null });
    const [check] = await CheckResult.find({ monitor: monitor._id });
    expect(check).toMatchObject({ success: true, httpStatus: 200, responseTimeMs: 42, checkedAt });
  });

  it('discards the result of a worker that lost its lease', async () => {
    await createDueMonitor();
    const stale = await claimDueMonitor();
    const current = await claimDueMonitor(new Date(stale.nextCheckAt.getTime() + 1000));

    const staleResult = await recordCheckOutcome(stale, down, { checkedAt: new Date() });
    expect(staleResult.applied).toBe(false);
    expect(await CheckResult.countDocuments()).toBe(0);

    const currentResult = await recordCheckOutcome(current, up, { checkedAt: new Date() });
    expect(currentResult.applied).toBe(true);
    expect(await CheckResult.countDocuments()).toBe(1);
  });

  it('discards an in-flight result when the monitor is paused during the check', async () => {
    const monitor = await createDueMonitor();
    const claimed = await claimDueMonitor();
    await updateMonitor(monitor.id, { paused: true });

    const result = await recordCheckOutcome(claimed, down, { checkedAt: new Date() });

    expect(result.applied).toBe(false);
    expect(await CheckResult.countDocuments()).toBe(0);
  });

  it('discards an in-flight result when the monitor is deleted during the check', async () => {
    const monitor = await createDueMonitor();
    const claimed = await claimDueMonitor();
    await Monitor.findByIdAndDelete(monitor._id);

    const result = await recordCheckOutcome(claimed, down, { checkedAt: new Date() });

    expect(result.applied).toBe(false);
    expect(await CheckResult.countDocuments()).toBe(0);
  });
});

describe('incidents', () => {
  const at = (minutes) => new Date(Date.UTC(2026, 0, 1, 0, minutes));

  it('opens nothing before the 3rd failure', async () => {
    const monitor = await createDueMonitor({ status: 'UP' });
    await runCycle(monitor, down, at(0));
    await runCycle(monitor, down, at(1));
    expect(await Incident.countDocuments()).toBe(0);
    expect((await Monitor.findById(monitor._id)).status).toBe('UP');
  });

  it('opens one incident dated from the first failure', async () => {
    const monitor = await createDueMonitor({ status: 'UP' });
    await runCycle(monitor, down, at(0));
    await runCycle(monitor, down, at(1));
    const third = await runCycle(monitor, down, at(2));
    await runCycle(monitor, down, at(3));

    expect(third.transition).toBe('DOWN');
    const incidents = await Incident.find();
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ status: 'OPEN', startedAt: at(0), errorCode: 'HTTP_STATUS', httpStatus: 503 });
  });

  it('closes it on the 2nd success, dated from the first success', async () => {
    const monitor = await createDueMonitor({ status: 'UP' });
    for (const minute of [0, 1, 2]) await runCycle(monitor, down, at(minute));

    const firstSuccess = await runCycle(monitor, up, at(3));
    expect(firstSuccess.transition).toBeNull();
    expect((await Incident.findOne()).status).toBe('OPEN');

    const secondSuccess = await runCycle(monitor, up, at(4));
    expect(secondSuccess.transition).toBe('RECOVERED');
    expect(await Incident.findOne()).toMatchObject({ status: 'RESOLVED', startedAt: at(0), endedAt: at(3), resolution: 'RECOVERED' });
  });

  it('creates a separate incident for a second outage', async () => {
    const monitor = await createDueMonitor({ status: 'UP' });
    for (const outcome of [down, down, down, up, up, down, down, down]) await runCycle(monitor, outcome);
    expect(await Incident.countDocuments({ status: 'RESOLVED' })).toBe(1);
    expect(await Incident.countDocuments({ status: 'OPEN' })).toBe(1);
  });

  it('the database refuses a second open incident for a monitor', async () => {
    const monitor = await createDueMonitor();
    await Incident.create({ monitor: monitor._id, startedAt: new Date() });
    await expect(Incident.create({ monitor: monitor._id, startedAt: new Date() })).rejects.toMatchObject({ code: 11000 });
  });

  it('opening concurrently is safe and leaves one incident', async () => {
    const monitor = await createDueMonitor();
    await Promise.all(
      Array.from({ length: 10 }, () => ensureOpenIncident(monitor._id, { startedAt: new Date(), errorCode: null, httpStatus: null })),
    );
    expect(await Incident.countDocuments()).toBe(1);
  });

  it('repairs a missing incident after a crash between the two writes', async () => {
    const monitor = await createDueMonitor({
      status: 'DOWN',
      consecutiveFailures: 3,
      failureStreakStartedAt: at(0),
    });
    expect(await Incident.countDocuments()).toBe(0);

    await runCycle(monitor, down, at(5));

    expect(await Incident.findOne()).toMatchObject({ status: 'OPEN', startedAt: at(0) });
  });

  it('repairs an unclosed incident after a crash between the two writes', async () => {
    const monitor = await createDueMonitor({
      status: 'UP',
      consecutiveSuccesses: 2,
      successStreakStartedAt: at(3),
    });
    await Incident.create({ monitor: monitor._id, startedAt: at(0) });

    await runCycle(monitor, up, at(5));

    expect(await Incident.findOne()).toMatchObject({ status: 'RESOLVED', endedAt: at(3), resolution: 'RECOVERED' });
  });

  it('pausing closes the incident without claiming a recovery', async () => {
    const monitor = await createDueMonitor({ status: 'UP' });
    for (const minute of [0, 1, 2]) await runCycle(monitor, down, at(minute));

    const updated = await updateMonitor(monitor.id, { paused: true });

    expect(updated).toMatchObject({ status: 'PENDING', paused: true, consecutiveFailures: 0 });
    expect(await Incident.findOne()).toMatchObject({ status: 'RESOLVED', resolution: 'MONITOR_RESET' });
  });
});

describe('CheckRunner', () => {
  const instantCheck = () => vi.fn().mockResolvedValue(up);

  it('runs each due monitor and records the results', async () => {
    await Promise.all(Array.from({ length: 3 }, () => createDueMonitor()));
    const httpCheck = instantCheck();
    const runner = new CheckRunner({ httpCheck });

    await runner.runDueChecks();
    await runner.drain();

    expect(httpCheck).toHaveBeenCalledTimes(3);
    expect(await CheckResult.countDocuments()).toBe(3);
  });

  it('passes the configured limits to the HTTP check', async () => {
    const monitor = await createDueMonitor();
    const httpCheck = instantCheck();
    const runner = new CheckRunner({ httpCheck, timeoutMs: 1234, maxBytes: 5678 });

    await runner.runDueChecks();
    await runner.drain();

    expect(httpCheck).toHaveBeenCalledWith(monitor.url, { timeoutMs: 1234, maxBytes: 5678 });
  });

  it('never exceeds the concurrency limit, and leaves the rest due', async () => {
    await Promise.all(Array.from({ length: 5 }, () => createDueMonitor()));
    let running = 0;
    let peak = 0;
    const release = [];
    const httpCheck = vi.fn(() => {
      running += 1;
      peak = Math.max(peak, running);
      return new Promise((resolve) => {
        release.push(() => {
          running -= 1;
          resolve(up);
        });
      });
    });
    const runner = new CheckRunner({ httpCheck, maxConcurrent: 2 });

    await runner.runDueChecks();
    await runner.runDueChecks();

    expect(httpCheck).toHaveBeenCalledTimes(2);
    expect(peak).toBe(2);

    release.splice(0).forEach((finish) => finish());
    await runner.drain();
    await runner.runDueChecks();
    expect(httpCheck).toHaveBeenCalledTimes(4);
    expect(peak).toBe(2);

    release.splice(0).forEach((finish) => finish());
    await runner.drain();
  });

  it('two workers sharing a database never check one monitor twice', async () => {
    await Promise.all(Array.from({ length: 10 }, () => createDueMonitor()));
    const httpCheck = instantCheck();
    const workers = [new CheckRunner({ httpCheck }), new CheckRunner({ httpCheck })];

    await Promise.all(workers.map((worker) => worker.runDueChecks()));
    await Promise.all(workers.map((worker) => worker.drain()));

    const urls = httpCheck.mock.calls.map(([url]) => url);
    expect(urls).toHaveLength(10);
    expect(new Set(urls).size).toBe(10);
    expect(await CheckResult.countDocuments()).toBe(10);
  });

  it('recovers its slot after a failed save', async () => {
    await createDueMonitor();
    const runner = new CheckRunner({ httpCheck: vi.fn().mockRejectedValue(new Error('boom')) });

    await runner.runDueChecks();
    await runner.drain();

    expect(runner.activeSlots).toBe(0);
  });

  it('refuses a manual check when at capacity', async () => {
    const monitor = await createDueMonitor();
    const runner = new CheckRunner({ httpCheck: instantCheck(), maxConcurrent: 1 });
    runner.activeSlots = 1;
    await expect(runner.runManualCheck(monitor.id)).rejects.toMatchObject({ statusCode: 503 });
  });

  it('releases the slot after a refused manual check', async () => {
    const monitor = await createDueMonitor({ paused: true });
    const runner = new CheckRunner({ httpCheck: instantCheck() });
    await expect(runner.runManualCheck(monitor.id)).rejects.toMatchObject({ code: 'MONITOR_PAUSED' });
    await runner.drain();
    expect(runner.activeSlots).toBe(0);
    expect(runner.inFlight.size).toBe(0);
  });
});
