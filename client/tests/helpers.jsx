import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { App } from '../src/App.jsx';
import { AuthProvider } from '../src/context/AuthContext.jsx';
import { ToastProvider } from '../src/context/ToastContext.jsx';

const json = (status, body) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * Replaces fetch with a table of "METHOD /path" handlers, using the real API shapes.
 * Anything not listed fails the test loudly rather than returning empty data.
 */
export function mockApi(routes) {
  const calls = [];
  const fetchMock = vi.fn(async (input, init = {}) => {
    const method = init.method ?? 'GET';
    const path = String(input).split('?')[0].replace(/^\/api/, '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body });

    const handler = routes[`${method} ${path}`];
    if (!handler) throw new Error(`Unexpected request: ${method} ${path}`);
    const [status, payload] = await handler(body);
    return json(status, payload);
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

export const signedIn = { 'GET /auth/session': () => [200, { data: { authenticated: true } }] };
export const signedOut = { 'GET /auth/session': () => [200, { data: { authenticated: false } }] };

export function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

export const insufficient = {
  status: 'INSUFFICIENT_DATA',
  uptimePercent: null,
  coveragePercent: 0.3,
  totalChecks: 4,
  successfulChecks: 4,
  failedChecks: 0,
  avgResponseTimeMs: 150,
};

export function makeMonitor(overrides = {}) {
  return {
    id: 'a'.repeat(24),
    name: 'Example',
    url: 'https://example.com/',
    paused: false,
    status: 'UP',
    consecutiveFailures: 0,
    consecutiveSuccesses: 4,
    lastCheckedAt: new Date().toISOString(),
    lastResponseTimeMs: 146,
    lastHttpStatus: 200,
    lastErrorCode: null,
    uptime24h: insufficient,
    ...overrides,
  };
}

export function makeSummary(overrides = {}) {
  return {
    monitors: { total: 1, up: 1, down: 0, pending: 0, paused: 0 },
    openIncidents: 0,
    uptime24h: insufficient,
    recentIncidents: [],
    alertDelivery: { failed: 0, retrying: 0, recent: [] },
    ...overrides,
  };
}
