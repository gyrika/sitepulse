import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Alert } from '../src/models/Alert.js';
import { CheckResult } from '../src/models/CheckResult.js';
import { Incident } from '../src/models/Incident.js';
import { Monitor } from '../src/models/Monitor.js';
import { useTestDatabase } from './helpers/db.js';

useTestDatabase();

const app = createApp();
const TOKEN = process.env.ADMIN_API_TOKEN;
const MISSING_ID = '507f1f77bcf86cd799439011';

const api = (method, path) => request(app)[method](path).set('Authorization', `Bearer ${TOKEN}`);

// Public IP literals keep these tests free of real DNS.
const createMonitor = (overrides = {}) =>
  api('post', '/api/monitors').send({ name: 'Example', url: 'https://93.184.216.34/', ...overrides });

const expectError = (res, status, code) => {
  expect(res.status).toBe(status);
  expect(res.body.error.code).toBe(code);
  expect(typeof res.body.error.message).toBe('string');
};

describe('authentication', () => {
  it.each([
    ['get', '/api/monitors'],
    ['post', '/api/monitors'],
    ['get', `/api/monitors/${MISSING_ID}`],
    ['patch', `/api/monitors/${MISSING_ID}`],
    ['delete', `/api/monitors/${MISSING_ID}`],
    ['get', `/api/monitors/${MISSING_ID}/checks`],
    ['post', `/api/monitors/${MISSING_ID}/check`],
    ['get', `/api/monitors/${MISSING_ID}/incidents`],
    ['get', '/api/dashboard/summary'],
  ])('%s %s requires a token', async (method, path) => {
    expectError(await request(app)[method](path), 401, 'UNAUTHORIZED');
  });

  it('rejects a wrong token', async () => {
    const res = await request(app).get('/api/monitors').set('Authorization', 'Bearer wrong');
    expectError(res, 401, 'UNAUTHORIZED');
  });

  it('rejects the right token with the wrong scheme', async () => {
    const res = await request(app).get('/api/monitors').set('Authorization', `Basic ${TOKEN}`);
    expectError(res, 401, 'UNAUTHORIZED');
  });

  it('health is public and reveals only the status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('POST /api/monitors', () => {
  it('creates a monitor and hides internal fields', async () => {
    const res = await createMonitor();
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'Example', url: 'https://93.184.216.34/', status: 'PENDING', paused: false });
    expect(res.body.data.id).toBeTypeOf('string');
    for (const field of ['_id', '__v', 'lockToken', 'lockedUntil', 'nextCheckAt']) {
      expect(res.body.data).not.toHaveProperty(field);
    }
  });

  it.each([
    ['http://localhost/'],
    ['http://127.0.0.1/'],
    ['http://2130706433/'],
    ['http://10.0.0.1/'],
    ['http://192.168.1.1/'],
    ['http://169.254.169.254/latest/meta-data/'],
    ['http://[::1]/'],
    ['http://[::ffff:127.0.0.1]/'],
    ['http://[::7f00:1]/'],
    ['http://[fd00::1]/'],
    ['http://[fe80::1]/'],
  ])('refuses SSRF target %s', async (url) => {
    expectError(await createMonitor({ url }), 422, 'BLOCKED_TARGET');
    expect(await Monitor.countDocuments()).toBe(0);
  });

  it.each([['ftp://example.com/'], ['file:///etc/passwd'], ['https://user:pass@example.com/'], ['nonsense']])(
    'refuses invalid URL %s',
    async (url) => {
      expectError(await createMonitor({ url }), 422, 'INVALID_URL');
    },
  );

  it('refuses a duplicate URL', async () => {
    await createMonitor();
    expectError(await createMonitor({ name: 'Copy' }), 409, 'DUPLICATE_MONITOR');
  });

  it.each([
    ['missing name', { url: 'https://93.184.216.34/' }],
    ['missing url', { name: 'x' }],
    ['blank name', { name: '   ', url: 'https://93.184.216.34/' }],
    ['non-string url', { name: 'x', url: { $ne: null } }],
    ['oversized url', { name: 'x', url: `https://93.184.216.34/${'a'.repeat(2100)}` }],
    ['unknown field', { name: 'x', url: 'https://93.184.216.34/', status: 'UP' }],
    ['internal field', { name: 'x', url: 'https://93.184.216.34/', lockToken: 'x' }],
  ])('refuses %s', async (_label, body) => {
    const res = await api('post', '/api/monitors').send(body);
    expectError(res, 400, 'VALIDATION_ERROR');
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it('reports malformed JSON', async () => {
    const res = await api('post', '/api/monitors').set('Content-Type', 'application/json').send('{bad');
    expectError(res, 400, 'INVALID_JSON');
  });

  it('reports an oversized body', async () => {
    const res = await api('post', '/api/monitors').send({ name: 'x'.repeat(20 * 1024), url: 'https://93.184.216.34/' });
    expectError(res, 413, 'PAYLOAD_TOO_LARGE');
  });
});

describe('monitor reads', () => {
  it('lists monitors with 24-hour stats', async () => {
    await createMonitor();
    const res = await api('get', '/api/monitors');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].uptime24h).toMatchObject({ status: 'INSUFFICIENT_DATA', uptimePercent: null });
  });

  it('returns an empty list when there is nothing to show', async () => {
    expect((await api('get', '/api/monitors')).body.data).toEqual([]);
  });

  it('returns one monitor with all three uptime windows', async () => {
    const { body } = await createMonitor();
    const res = await api('get', `/api/monitors/${body.data.id}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data.uptime)).toEqual(['24h', '7d', '30d']);
  });

  it('reports a missing monitor', async () => {
    expectError(await api('get', `/api/monitors/${MISSING_ID}`), 404, 'MONITOR_NOT_FOUND');
  });

  it('reports a malformed id', async () => {
    expectError(await api('get', '/api/monitors/not-an-id'), 400, 'VALIDATION_ERROR');
  });

  it('reports an unknown route', async () => {
    expectError(await api('get', '/api/nope'), 404, 'ROUTE_NOT_FOUND');
  });
});

describe('PATCH /api/monitors/:id', () => {
  const makeDownMonitor = async () => {
    const { body } = await createMonitor();
    await Monitor.updateOne({ _id: body.data.id }, { status: 'DOWN', consecutiveFailures: 3 });
    await Incident.create({ monitor: body.data.id, startedAt: new Date() });
    return body.data.id;
  };

  it('renames without disturbing monitoring state', async () => {
    const id = await makeDownMonitor();
    const res = await api('patch', `/api/monitors/${id}`).send({ name: 'Renamed' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Renamed', status: 'DOWN', consecutiveFailures: 3 });
    expect(await Incident.countDocuments({ status: 'OPEN' })).toBe(1);
  });

  it('pauses and resumes, resetting state', async () => {
    const id = await makeDownMonitor();

    const paused = await api('patch', `/api/monitors/${id}`).send({ paused: true });
    expect(paused.body.data).toMatchObject({ paused: true, status: 'PENDING', consecutiveFailures: 0 });
    expect(await Incident.findOne()).toMatchObject({ status: 'RESOLVED', resolution: 'MONITOR_RESET' });

    const resumed = await api('patch', `/api/monitors/${id}`).send({ paused: false });
    expect(resumed.body.data).toMatchObject({ paused: false, status: 'PENDING' });
    expect((await Monitor.findById(id)).nextCheckAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('resets state when the URL changes', async () => {
    const id = await makeDownMonitor();
    const res = await api('patch', `/api/monitors/${id}`).send({ url: 'https://1.1.1.1/' });
    expect(res.body.data).toMatchObject({ url: 'https://1.1.1.1/', status: 'PENDING' });
  });

  it('keeps state when the same URL is resubmitted', async () => {
    const id = await makeDownMonitor();
    const res = await api('patch', `/api/monitors/${id}`).send({ url: 'https://93.184.216.34/' });
    expect(res.body.data).toMatchObject({ status: 'DOWN' });
  });

  it('applies the same SSRF policy to edits', async () => {
    const { body } = await createMonitor();
    const res = await api('patch', `/api/monitors/${body.data.id}`).send({ url: 'http://169.254.169.254/' });
    expectError(res, 422, 'BLOCKED_TARGET');
    expect((await Monitor.findById(body.data.id)).url).toBe('https://93.184.216.34/');
  });

  it('refuses an empty update and internal fields', async () => {
    const { body } = await createMonitor();
    expectError(await api('patch', `/api/monitors/${body.data.id}`).send({}), 400, 'VALIDATION_ERROR');
    expectError(await api('patch', `/api/monitors/${body.data.id}`).send({ status: 'UP' }), 400, 'VALIDATION_ERROR');
  });

  it('refuses a URL another monitor already uses', async () => {
    await createMonitor();
    const { body } = await createMonitor({ url: 'https://1.1.1.1/' });
    const res = await api('patch', `/api/monitors/${body.data.id}`).send({ url: 'https://93.184.216.34/' });
    expectError(res, 409, 'DUPLICATE_MONITOR');
  });
});

describe('DELETE /api/monitors/:id', () => {
  it('deletes the monitor and its history', async () => {
    const { body } = await createMonitor();
    const id = body.data.id;
    await CheckResult.create({ monitor: id, checkedAt: new Date(), success: true });
    await Incident.create({ monitor: id, startedAt: new Date() });

    const res = await api('delete', `/api/monitors/${id}`);

    expect(res.status).toBe(204);
    expect(await Monitor.countDocuments()).toBe(0);
    expect(await CheckResult.countDocuments()).toBe(0);
    expect(await Incident.countDocuments()).toBe(0);
  });

  it('reports a missing monitor', async () => {
    expectError(await api('delete', `/api/monitors/${MISSING_ID}`), 404, 'MONITOR_NOT_FOUND');
  });
});

describe('GET /api/monitors/:id/checks', () => {
  it('returns newest first with cursor pagination', async () => {
    const { body } = await createMonitor();
    const id = body.data.id;
    const base = Date.now() - 10 * 60_000;
    await CheckResult.insertMany(
      [0, 1, 2].map((index) => ({ monitor: id, checkedAt: new Date(base + index * 60_000), success: true })),
    );

    const firstPage = await api('get', `/api/monitors/${id}/checks?limit=2`);
    expect(firstPage.body.data.map((check) => check.checkedAt)).toEqual([
      new Date(base + 120_000).toISOString(),
      new Date(base + 60_000).toISOString(),
    ]);

    const secondPage = await api('get', `/api/monitors/${id}/checks`).query({ limit: 2, before: firstPage.body.meta.nextBefore });
    expect(secondPage.body.data).toHaveLength(1);
    expect(secondPage.body.meta.nextBefore).toBeNull();
  });

  it.each([['limit=0'], ['limit=9999'], ['limit=abc'], ['before=yesterday'], ['since[$gt]=1']])(
    'refuses query %s',
    async (query) => {
      const { body } = await createMonitor();
      expectError(await api('get', `/api/monitors/${body.data.id}/checks?${query}`), 400, 'VALIDATION_ERROR');
    },
  );

  it('reports a missing monitor', async () => {
    expectError(await api('get', `/api/monitors/${MISSING_ID}/checks`), 404, 'MONITOR_NOT_FOUND');
  });
});

describe('GET /api/monitors/:id/incidents', () => {
  it('lists and filters incidents', async () => {
    const { body } = await createMonitor();
    const id = body.data.id;
    await Incident.create({ monitor: id, startedAt: new Date(Date.now() - 60_000) });
    await Incident.create({ monitor: id, startedAt: new Date(Date.now() - 120_000), status: 'RESOLVED', endedAt: new Date(), resolution: 'RECOVERED' });

    expect((await api('get', `/api/monitors/${id}/incidents`)).body.data).toHaveLength(2);
    const open = await api('get', `/api/monitors/${id}/incidents?status=OPEN`);
    expect(open.body.data.map((incident) => incident.status)).toEqual(['OPEN']);
  });

  it('refuses an unknown status filter', async () => {
    const { body } = await createMonitor();
    expectError(await api('get', `/api/monitors/${body.data.id}/incidents?status=NOPE`), 400, 'VALIDATION_ERROR');
  });
});

describe('POST /api/monitors/:id/check', () => {
  it('applies the SSRF policy to manual checks, even for a stored unsafe URL', async () => {
    // Simulates data that predates the policy or was written directly to the database.
    const monitor = await Monitor.create({ name: 'Internal', url: 'http://169.254.169.254/latest/meta-data/' });

    const res = await api('post', `/api/monitors/${monitor.id}/check`);

    expect(res.status).toBe(200);
    expect(res.body.data.check).toMatchObject({ success: false, source: 'MANUAL', errorCode: 'BLOCKED_TARGET', httpStatus: null });
    expect(JSON.stringify(res.body)).not.toContain('meta-data"');
  });

  it('refuses a paused monitor', async () => {
    const { body } = await createMonitor({ paused: true });
    expectError(await api('post', `/api/monitors/${body.data.id}/check`), 409, 'MONITOR_PAUSED');
  });

  it('refuses while a check is already running', async () => {
    const { body } = await createMonitor();
    await Monitor.updateOne({ _id: body.data.id }, { lockToken: 'other', lockedUntil: new Date(Date.now() + 30_000) });
    expectError(await api('post', `/api/monitors/${body.data.id}/check`), 409, 'CHECK_IN_PROGRESS');
  });

  it('reports a missing monitor', async () => {
    expectError(await api('post', `/api/monitors/${MISSING_ID}/check`), 404, 'MONITOR_NOT_FOUND');
  });
});

describe('uptime statistics', () => {
  const MINUTE = 60_000;

  // Inserts `count` checks, one a minute, ending just before now.
  const seedChecks = (monitorId, count, { failures = 0, startMinutesAgo = count } = {}) =>
    CheckResult.insertMany(
      Array.from({ length: count }, (_value, index) => ({
        monitor: monitorId,
        checkedAt: new Date(Date.now() - (startMinutesAgo - index) * MINUTE),
        success: index >= failures,
        responseTimeMs: index >= failures ? 100 : null,
      })),
    );

  it('reports insufficient data for a monitor with a few checks, never 100%', async () => {
    const { body } = await createMonitor();
    await seedChecks(body.data.id, 10);

    const { uptime } = (await api('get', `/api/monitors/${body.data.id}`)).body.data;

    for (const window of ['24h', '7d', '30d']) {
      expect(uptime[window]).toMatchObject({ status: 'INSUFFICIENT_DATA', uptimePercent: null, totalChecks: 10 });
    }
    expect(uptime['24h'].coveragePercent).toBe(0.694);
  });

  it('reports insufficient data with no checks at all', async () => {
    const { body } = await createMonitor();
    const { uptime } = (await api('get', `/api/monitors/${body.data.id}`)).body.data;
    expect(uptime['24h']).toMatchObject({ status: 'INSUFFICIENT_DATA', uptimePercent: null, totalChecks: 0, coveragePercent: 0 });
  });

  it('computes uptime from recorded checks once coverage is sufficient', async () => {
    const { body } = await createMonitor();
    await seedChecks(body.data.id, 1000, { failures: 10 });

    const { uptime } = (await api('get', `/api/monitors/${body.data.id}`)).body.data;

    expect(uptime['24h']).toMatchObject({
      status: 'OK',
      uptimePercent: 99,
      totalChecks: 1000,
      successfulChecks: 990,
      failedChecks: 10,
      avgResponseTimeMs: 100,
    });
    expect(uptime['7d']).toMatchObject({ status: 'INSUFFICIENT_DATA', uptimePercent: null });
  });

  it('does not count time without checks as uptime', async () => {
    const { body } = await createMonitor();
    // 800 minutes of pure failures 2 days ago are outside 24h; the 24h window has a gap.
    await seedChecks(body.data.id, 800, { failures: 800, startMinutesAgo: 2 * 24 * 60 });

    const { uptime } = (await api('get', `/api/monitors/${body.data.id}`)).body.data;

    expect(uptime['24h']).toMatchObject({ totalChecks: 0, uptimePercent: null });
    expect(uptime['7d']).toMatchObject({ totalChecks: 800, failedChecks: 800 });
  });

  it('never reports more than 100% coverage', async () => {
    const { body } = await createMonitor();
    await CheckResult.insertMany(
      Array.from({ length: 2000 }, () => ({ monitor: body.data.id, checkedAt: new Date(Date.now() - MINUTE), success: true })),
    );
    const { uptime } = (await api('get', `/api/monitors/${body.data.id}`)).body.data;
    expect(uptime['24h'].coveragePercent).toBe(100);
  });
});

describe('GET /api/dashboard/summary', () => {
  it('handles an empty system', async () => {
    const res = await api('get', '/api/dashboard/summary');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      monitors: { total: 0, up: 0, down: 0, pending: 0, paused: 0 },
      openIncidents: 0,
      recentIncidents: [],
      uptime24h: { status: 'INSUFFICIENT_DATA', uptimePercent: null },
    });
  });

  it('summarises real data', async () => {
    const up = await Monitor.create({ name: 'Up', url: 'https://1.1.1.1/', status: 'UP' });
    const down = await Monitor.create({ name: 'Down', url: 'https://8.8.8.8/', status: 'DOWN' });
    await Monitor.create({ name: 'New', url: 'https://8.8.4.4/' });
    await Monitor.create({ name: 'Paused', url: 'https://9.9.9.9/', paused: true });
    await Incident.create({ monitor: down._id, startedAt: new Date() });
    await CheckResult.create({ monitor: up._id, checkedAt: new Date(), success: true, responseTimeMs: 50 });

    const { data } = (await api('get', '/api/dashboard/summary')).body;

    expect(data.monitors).toEqual({ total: 4, up: 1, down: 1, pending: 1, paused: 1 });
    expect(data.openIncidents).toBe(1);
    expect(data.recentIncidents[0].monitor).toMatchObject({ name: 'Down', url: 'https://8.8.8.8/' });
    expect(data.uptime24h.totalChecks).toBe(1);
  });

  describe('alert delivery problems', () => {
    const DAY_MS = 24 * 60 * 60_000;
    let monitor;
    let incidentCounter = 0;

    const createAlert = async (fields) => {
      incidentCounter += 1;
      monitor ??= await Monitor.create({ name: 'Shop', url: 'https://1.1.1.1/' });
      const incident = await Incident.create({ monitor: monitor._id, status: 'RESOLVED', startedAt: new Date(incidentCounter) });
      return Alert.create({ incident: incident._id, monitor: monitor._id, type: 'DOWN', occurredAt: new Date(), ...fields });
    };

    const delivery = async () => (await api('get', '/api/dashboard/summary')).body.data.alertDelivery;

    beforeEach(() => {
      monitor = null;
    });

    it('is empty when alerts were delivered or are simply waiting', async () => {
      await createAlert({ status: 'SENT' });
      await createAlert({ status: 'CANCELLED', lastError: 'too late' });
      await createAlert({ status: 'PENDING' });

      expect(await delivery()).toEqual({ failed: 0, retrying: 0, recent: [] });
    });

    it('reports failed and retrying alerts with the monitor and reason', async () => {
      await createAlert({ status: 'FAILED', attempts: 6, lastError: 'auth rejected' });
      await createAlert({ status: 'PENDING', attempts: 1, lastError: 'connection refused' });

      const result = await delivery();

      expect(result).toMatchObject({ failed: 1, retrying: 1 });
      expect(result.recent.map((alert) => alert.lastError).sort()).toEqual(['auth rejected', 'connection refused']);
      expect(result.recent[0].monitor).toMatchObject({ name: 'Shop', url: 'https://1.1.1.1/' });
      expect(result.recent[0]).not.toHaveProperty('lockToken');
    });

    it('stops showing a failed alert after 7 days, but never hides a retry', async () => {
      const old = await createAlert({ status: 'FAILED', lastError: 'old failure' });
      const retry = await createAlert({ status: 'PENDING', lastError: 'still trying' });
      const eightDaysAgo = new Date(Date.now() - 8 * DAY_MS);
      await Alert.collection.updateMany({ _id: { $in: [old._id, retry._id] } }, { $set: { updatedAt: eightDaysAgo } });

      expect(await delivery()).toMatchObject({ failed: 0, retrying: 1 });
    });

    it('counts everything but lists only the latest five', async () => {
      for (let i = 0; i < 7; i += 1) await createAlert({ status: 'FAILED', lastError: `failure ${i}` });

      const result = await delivery();

      expect(result.failed).toBe(7);
      expect(result.recent).toHaveLength(5);
    });
  });
});
