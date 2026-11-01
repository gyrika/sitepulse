import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createSessionValue, isValidSessionValue, SESSION_COOKIE } from '../src/services/sessionService.js';
import { useTestDatabase } from './helpers/db.js';

useTestDatabase();

const PASSWORD = process.env.ADMIN_PASSWORD;
const TRUSTED_ORIGIN = 'http://localhost:5173';

const login = (agent, password = PASSWORD) => agent.post('/api/auth/login').send({ password });

describe('login', () => {
  it('sets a hardened session cookie and grants access', async () => {
    const agent = request.agent(createApp());

    const res = await login(agent);

    expect(res.status).toBe(200);
    const [cookie] = res.headers['set-cookie'];
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toContain(PASSWORD);
    expect((await agent.get('/api/monitors')).status).toBe(200);
  });

  it('refuses a wrong password and sets no cookie', async () => {
    const agent = request.agent(createApp());

    const res = await login(agent, 'not-the-password');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect((await agent.get('/api/monitors')).status).toBe(401);
  });

  it.each([[{}], [{ password: '' }], [{ password: { $ne: null } }], [{ password: PASSWORD, admin: true }]])(
    'refuses malformed body %j',
    async (body) => {
      const res = await request(createApp()).post('/api/auth/login').send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    },
  );

  it('blocks guessing after 10 failed attempts, even with the right password', async () => {
    const app = createApp();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await login(request(app), 'wrong-guess');
    }
    const res = await login(request(app));
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('TOO_MANY_ATTEMPTS');
  });
});

describe('session', () => {
  it('reports signed out and signed in', async () => {
    const agent = request.agent(createApp());
    expect((await agent.get('/api/auth/session')).body.data.authenticated).toBe(false);
    await login(agent);
    expect((await agent.get('/api/auth/session')).body.data.authenticated).toBe(true);
  });

  it('logout ends the session in that browser', async () => {
    const agent = request.agent(createApp());
    await login(agent);

    expect((await agent.post('/api/auth/logout')).status).toBe(204);

    expect((await agent.get('/api/monitors')).status).toBe(401);
  });

  it.each([
    ['garbage', 'garbage'],
    ['a forged signature', `${Date.now() + 1e9}.forged`],
    ['extra parts', `${Date.now() + 1e9}.a.b`],
  ])('refuses %s', async (_label, value) => {
    const res = await request(createApp()).get('/api/monitors').set('Cookie', `${SESSION_COOKIE}=${value}`);
    expect(res.status).toBe(401);
  });

  it('refuses a real signature with an extended expiry', () => {
    const { value } = createSessionValue();
    const [, signature] = value.split('.');
    expect(isValidSessionValue(`${Date.now() + 1e12}.${signature}`)).toBe(false);
  });

  it('expires', () => {
    const issuedAt = Date.now();
    const { value, maxAgeMs } = createSessionValue(issuedAt);
    expect(isValidSessionValue(value, issuedAt + maxAgeMs - 1)).toBe(true);
    expect(isValidSessionValue(value, issuedAt + maxAgeMs + 1)).toBe(false);
  });

  it('non-string input is simply invalid', () => {
    expect(isValidSessionValue(undefined)).toBe(false);
    expect(isValidSessionValue({ a: 1 })).toBe(false);
  });
});

describe('cross-site protection for cookie sessions', () => {
  const body = { name: 'Example', url: 'https://93.184.216.34/' };

  it('refuses a write from an untrusted origin', async () => {
    const agent = request.agent(createApp());
    await login(agent);
    const res = await agent.post('/api/monitors').set('Origin', 'https://evil.example').send(body);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('UNTRUSTED_ORIGIN');
  });

  it('allows a write from the dashboard origin', async () => {
    const agent = request.agent(createApp());
    await login(agent);
    const res = await agent.post('/api/monitors').set('Origin', TRUSTED_ORIGIN).send(body);
    expect(res.status).toBe(201);
  });

  it('does not grant CORS access to an untrusted origin', async () => {
    const res = await request(createApp()).get('/api/auth/session').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
