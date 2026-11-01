import { describe, expect, it, vi } from 'vitest';
import { startApplication } from '../src/bootstrap.js';
import { loadConfig } from '../src/config/env.js';

function fakeDeps(order, overrides = {}) {
  return {
    connect: vi.fn(async () => order.push('connect')),
    disconnect: vi.fn(async () => order.push('disconnect')),
    startScheduler: vi.fn(() => {
      order.push('scheduler');
      return { destroy: vi.fn(async () => order.push('scheduler-stop')) };
    }),
    startAlerts: vi.fn(() => {
      order.push('alerts');
      return { destroy: vi.fn(async () => order.push('alerts-stop')) };
    }),
    drainChecks: vi.fn(async () => order.push('drain')),
    drainAlerts: vi.fn(async () => order.push('drain-alerts')),
    listen: vi.fn(async () => {
      order.push('listen');
      return { close: (done) => { order.push('server-close'); done(); } };
    }),
    ...overrides,
  };
}

describe('startApplication', () => {
  it('starts the scheduler only after MongoDB connects', async () => {
    const order = [];
    await startApplication(fakeDeps(order));
    expect(order).toEqual(['connect', 'scheduler', 'alerts', 'listen']);
  });

  it('starts nothing when MongoDB cannot connect', async () => {
    const order = [];
    const deps = fakeDeps(order, { connect: vi.fn().mockRejectedValue(new Error('no database')) });

    await expect(startApplication(deps)).rejects.toThrow('no database');

    expect(deps.startScheduler).not.toHaveBeenCalled();
    expect(deps.startAlerts).not.toHaveBeenCalled();
    expect(deps.listen).not.toHaveBeenCalled();
  });

  it('shuts down in reverse order, finishing running checks first', async () => {
    const order = [];
    const shutdown = await startApplication(fakeDeps(order));
    order.length = 0;

    await shutdown();

    expect(order).toEqual(['scheduler-stop', 'alerts-stop', 'server-close', 'drain', 'drain-alerts', 'disconnect']);
  });
});

describe('loadConfig', () => {
  const valid = {
    MONGODB_URI: 'mongodb://db/app',
    ADMIN_API_TOKEN: 'x'.repeat(32),
    ADMIN_PASSWORD: 'p'.repeat(12),
    SESSION_SECRET: 's'.repeat(32),
  };

  it('applies safe defaults', () => {
    expect(loadConfig(valid)).toMatchObject({
      host: '127.0.0.1',
      port: 4000,
      checkTimeoutMs: 10000,
      checkMaxResponseBytes: 1048576,
      checkMaxConcurrency: 20,
    });
  });

  describe('email alerts', () => {
    const smtp = { ...valid, SMTP_HOST: 'smtp.example.com', ALERT_EMAIL_FROM: 'from@example.com', ALERT_EMAIL_TO: 'a@example.com, b@example.com' };

    it('are off by default, and a blank SMTP_HOST means off', () => {
      expect(loadConfig(valid).alerts.enabled).toBe(false);
      expect(loadConfig({ ...valid, SMTP_HOST: '', SMTP_PORT: '', ALERT_EMAIL_TO: '' }).alerts.enabled).toBe(false);
    });

    it('default to STARTTLS on port 587 and split the recipients', () => {
      expect(loadConfig(smtp).alerts).toMatchObject({
        enabled: true,
        smtpPort: 587,
        smtpSecurity: 'starttls',
        to: ['a@example.com', 'b@example.com'],
      });
    });

    it('default to port 465 with implicit TLS', () => {
      expect(loadConfig({ ...smtp, SMTP_SECURITY: 'tls' }).alerts.smtpPort).toBe(465);
    });

    it('refuse to start half configured', () => {
      expect(() => loadConfig({ ...smtp, ALERT_EMAIL_FROM: '' })).toThrow(/ALERT_EMAIL_FROM/);
      expect(() => loadConfig({ ...smtp, ALERT_EMAIL_TO: '' })).toThrow(/ALERT_EMAIL_TO/);
      expect(() => loadConfig({ ...smtp, ALERT_EMAIL_TO: 'not-an-address' })).toThrow(/ALERT_EMAIL_TO/);
      expect(() => loadConfig({ ...smtp, SMTP_USER: 'user' })).toThrow(/SMTP_PASSWORD/);
    });

    it('refuse unencrypted SMTP to another machine', () => {
      expect(() => loadConfig({ ...smtp, SMTP_SECURITY: 'none' })).toThrow(/SMTP_SECURITY/);
      expect(loadConfig({ ...smtp, SMTP_HOST: '127.0.0.1', SMTP_SECURITY: 'none' }).alerts.enabled).toBe(true);
    });

    it('never print the SMTP password in errors', () => {
      expect(() => loadConfig({ ...smtp, SMTP_PASSWORD: 'smtp-secret-value' })).toThrow(
        expect.not.objectContaining({ message: expect.stringContaining('smtp-secret-value') }),
      );
    });
  });

  it('refuses to start without an admin token', () => {
    const { ADMIN_API_TOKEN: _omitted, ...withoutToken } = valid;
    expect(() => loadConfig(withoutToken)).toThrow(/ADMIN_API_TOKEN/);
  });

  it('refuses a short admin token', () => {
    expect(() => loadConfig({ ...valid, ADMIN_API_TOKEN: 'short' })).toThrow(/ADMIN_API_TOKEN/);
  });

  it('refuses a short admin password or session secret', () => {
    expect(() => loadConfig({ ...valid, ADMIN_PASSWORD: 'short' })).toThrow(/ADMIN_PASSWORD/);
    expect(() => loadConfig({ ...valid, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
  });

  it('never prints secret values in its errors', () => {
    const secretUri = 'mongodb://user:hunter2@db/app';
    expect(() => loadConfig({ MONGODB_URI: secretUri, ADMIN_API_TOKEN: 'short-secret' })).toThrow(
      expect.not.objectContaining({ message: expect.stringContaining('short-secret') }),
    );
  });
});
