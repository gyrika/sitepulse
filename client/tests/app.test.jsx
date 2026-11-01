import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { insufficient, makeMonitor, makeSummary, mockApi, renderApp, signedIn, signedOut } from './helpers.jsx';

const ID = 'a'.repeat(24);
const overviewRoutes = (monitors, summary = makeSummary()) => ({
  ...signedIn,
  'GET /dashboard/summary': () => [200, { data: summary }],
  'GET /monitors': () => [200, { data: monitors }],
  [`GET /monitors/${ID}/checks`]: () => [200, { data: [], meta: {} }],
});

describe('signing in', () => {
  it('sends a signed-out visitor to the login page', async () => {
    mockApi(signedOut);
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Admin sign in' })).toBeInTheDocument();
  });

  it('shows the server message for a wrong password, and clears the field', async () => {
    mockApi({ ...signedOut, 'POST /auth/login': () => [401, { error: { code: 'INVALID_CREDENTIALS', message: 'That password is not correct.' } }] });
    const user = userEvent.setup();
    renderApp('/login');

    const field = await screen.findByLabelText('Password');
    await user.type(field, 'wrong{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent('That password is not correct.');
    expect(field).toHaveValue('');
  });

  it('asks for a password without calling the server', async () => {
    const calls = mockApi(signedOut);
    const user = userEvent.setup();
    renderApp('/login');

    await user.click(await screen.findByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter your password.');
    expect(calls.some((call) => call.path === '/auth/login')).toBe(false);
  });

  it('opens the dashboard after a correct password', async () => {
    mockApi({
      ...overviewRoutes([]),
      ...signedOut,
      'POST /auth/login': () => [200, { data: { authenticated: true } }],
    });
    const user = userEvent.setup();
    renderApp('/login');

    await user.type(await screen.findByLabelText('Password'), 'correct-password{Enter}');

    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
  });

  it('returns to the login page when the session expires mid-use', async () => {
    mockApi({
      ...signedIn,
      'GET /dashboard/summary': () => [401, { error: { code: 'UNAUTHORIZED', message: 'Please sign in.' } }],
      'GET /monitors': () => [401, { error: { code: 'UNAUTHORIZED', message: 'Please sign in.' } }],
    });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Admin sign in' })).toBeInTheDocument();
  });

  it('says so when the server cannot be reached, with a retry', async () => {
    mockApi({ 'GET /auth/session': () => { throw new TypeError('network down'); } });
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'SitePulse is not reachable' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('overview', () => {
  it('shows a loading state first', async () => {
    mockApi({ ...signedIn, 'GET /dashboard/summary': () => new Promise(() => {}), 'GET /monitors': () => new Promise(() => {}) });
    renderApp('/');
    expect(await screen.findByText('Loading dashboard')).toBeInTheDocument();
  });

  it('shows an empty state with a way to start', async () => {
    mockApi(overviewRoutes([], makeSummary({ monitors: { total: 0, up: 0, down: 0, pending: 0, paused: 0 } })));
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'No websites monitored yet' })).toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(within(main).getByRole('link', { name: 'Add monitor' })).toHaveAttribute('href', '/monitors/new');
  });

  it('shows an error state with a retry that works', async () => {
    let healthy = false;
    mockApi({
      ...signedIn,
      'GET /dashboard/summary': () => (healthy ? [200, { data: makeSummary() }] : [500, { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } }]),
      'GET /monitors': () => [200, { data: [makeMonitor()] }],
      [`GET /monitors/${ID}/checks`]: () => [200, { data: [] }],
    });
    const user = userEvent.setup();
    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'The dashboard could not be loaded' })).toBeInTheDocument();
    healthy = true;
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Sites up')).toBeInTheDocument();
  });

  it('keeps showing data with a warning when a background refresh fails', async () => {
    let healthy = true;
    const respond = (data) => () =>
      healthy ? [200, { data }] : [500, { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } }];
    mockApi({
      ...signedIn,
      'GET /dashboard/summary': respond(makeSummary()),
      'GET /monitors': respond([makeMonitor({ name: 'Shop' })]),
      [`GET /monitors/${ID}/checks`]: respond([]),
    });
    renderApp('/');
    expect(await screen.findByRole('link', { name: /Shop/ })).toBeInTheDocument();

    healthy = false;
    document.dispatchEvent(new Event('visibilitychange'));

    const [warning] = await screen.findAllByRole('alert');
    expect(warning).toHaveTextContent('Could not refresh, so this may be out of date.');
    expect(screen.getByRole('link', { name: /Shop/ })).toBeInTheDocument();
  });

  it('reports exactly what the API returned', async () => {
    mockApi(overviewRoutes(
      [makeMonitor({ name: 'Shop', lastResponseTimeMs: 321 })],
      makeSummary({ monitors: { total: 3, up: 1, down: 1, pending: 0, paused: 1 }, openIncidents: 1 }),
    ));
    renderApp('/');

    expect(await screen.findByText('1 of 2')).toBeInTheDocument();
    expect(screen.getByText('1 site is down.')).toBeInTheDocument();
    expect(screen.getByText('1 paused')).toBeInTheDocument();
    const card = screen.getByRole('link', { name: /Shop/ });
    expect(within(card).getByText('321 ms')).toBeInTheDocument();
  });

  it('never presents insufficient data as an uptime figure', async () => {
    mockApi(overviewRoutes([makeMonitor()]));
    renderApp('/');
    expect(await screen.findByText('Sites up')).toBeInTheDocument();
    expect(screen.getAllByText('Not enough data').length).toBeGreaterThan(0);
    expect(screen.queryByText(/100%/)).not.toBeInTheDocument();
  });

  it('lists down monitors first', async () => {
    mockApi(overviewRoutes([
      makeMonitor({ id: 'b'.repeat(24), name: 'A healthy site' }),
      makeMonitor({ name: 'Z broken site', status: 'DOWN' }),
    ]));
    renderApp('/');
    const section = (await screen.findByRole('heading', { name: 'Websites' })).closest('section');
    const names = within(section).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(names).toEqual(['Z broken site', 'A healthy site']);
  });

  it('warns about failures before a site is officially down', async () => {
    mockApi(overviewRoutes([makeMonitor({ consecutiveFailures: 2 })]));
    renderApp('/');
    expect(await screen.findByText('2 failed checks in a row')).toBeInTheDocument();
  });

  describe('alert delivery problems', () => {
    const failedAlert = {
      id: 'b'.repeat(24),
      type: 'DOWN',
      status: 'FAILED',
      attempts: 6,
      lastError: 'Invalid login: 535 not accepted',
      nextAttemptAt: new Date().toISOString(),
      monitor: { id: ID, name: 'Shop', url: 'https://shop.example.com/' },
    };
    const retryingAlert = {
      ...failedAlert,
      id: 'c'.repeat(24),
      type: 'RECOVERED',
      status: 'PENDING',
      attempts: 1,
      lastError: 'connect ECONNREFUSED',
    };

    it('says nothing when every alert was delivered', async () => {
      mockApi(overviewRoutes([makeMonitor()]));
      renderApp('/');
      await screen.findByText('Sites up');
      expect(screen.queryByText(/could not be sent|waiting to retry/)).not.toBeInTheDocument();
    });

    it('lists failed and retrying alerts with their reasons', async () => {
      const alertDelivery = { failed: 1, retrying: 1, recent: [failedAlert, retryingAlert] };
      mockApi(overviewRoutes([makeMonitor()], makeSummary({ alertDelivery })));
      renderApp('/');

      const notice = await screen.findByRole('region', { name: '1 alert email could not be sent, 1 alert email waiting to retry.' });
      expect(within(notice).getByText('Down alert')).toBeInTheDocument();
      expect(within(notice).getByText('Gave up after 6 attempts')).toBeInTheDocument();
      expect(within(notice).getByText('Invalid login: 535 not accepted')).toBeInTheDocument();
      expect(within(notice).getByText('Recovered alert')).toBeInTheDocument();
      expect(within(notice).getByText(/^Failed 1 attempt\. Next try/)).toBeInTheDocument();
      expect(within(notice).getAllByRole('link', { name: 'Shop' })[0]).toHaveAttribute('href', `/monitors/${ID}`);
    });

    it('says when more alerts exist than are listed', async () => {
      const alertDelivery = { failed: 12, retrying: 0, recent: [failedAlert] };
      mockApi(overviewRoutes([makeMonitor()], makeSummary({ alertDelivery })));
      renderApp('/');

      expect(await screen.findByRole('heading', { name: '12 alert emails could not be sent.' })).toBeInTheDocument();
      expect(screen.getByText('Showing the latest 1 of 12.')).toBeInTheDocument();
    });

    it('keeps the site status separate from email problems', async () => {
      const alertDelivery = { failed: 1, retrying: 0, recent: [failedAlert] };
      mockApi(overviewRoutes([makeMonitor()], makeSummary({ alertDelivery })));
      renderApp('/');
      expect(await screen.findByText('All monitored sites are up.')).toBeInTheDocument();
    });
  });
});

describe('adding a monitor', () => {
  const fillAndSubmit = async (user, name, url) => {
    await user.type(await screen.findByLabelText('Name'), name);
    await user.type(screen.getByLabelText('URL'), url);
    await user.click(screen.getByRole('button', { name: 'Add monitor' }));
  };

  it('requires both fields without calling the server', async () => {
    const calls = mockApi(signedIn);
    const user = userEvent.setup();
    renderApp('/monitors/new');

    await user.click(await screen.findByRole('button', { name: 'Add monitor' }));

    expect(await screen.findByText('Enter a name for this monitor.')).toBeInTheDocument();
    expect(screen.getByText('Enter the address to monitor.')).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it.each([
    ['BLOCKED_TARGET', 'This address is not allowed.', /private or reserved/],
    ['DNS_ERROR', 'The host name could not be resolved.', /could not be found/],
    ['INVALID_URL', 'Only HTTP and HTTPS URLs are allowed.', /Only HTTP and HTTPS/],
    ['DUPLICATE_MONITOR', 'A monitor for this URL already exists.', /already exists/],
  ])('shows a %s error on the URL field and keeps what was typed', async (code, message, expected) => {
    mockApi({ ...signedIn, 'POST /monitors': () => [422, { error: { code, message } }] });
    const user = userEvent.setup();
    renderApp('/monitors/new');

    await fillAndSubmit(user, 'Site', 'http://10.0.0.1/');

    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(screen.getByLabelText('URL')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('URL')).toHaveValue('http://10.0.0.1/');
  });

  it('shows validation details on the matching field', async () => {
    mockApi({
      ...signedIn,
      'POST /monitors': () => [400, { error: { code: 'VALIDATION_ERROR', message: 'Bad', details: [{ field: 'body.name', message: 'Name is too long.' }] } }],
    });
    const user = userEvent.setup();
    renderApp('/monitors/new');

    await fillAndSubmit(user, 'Site', 'https://example.com');

    expect(await screen.findByText('Name is too long.')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows other failures at the top of the form', async () => {
    mockApi({ ...signedIn, 'POST /monitors': () => [500, { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } }] });
    const user = userEvent.setup();
    renderApp('/monitors/new');

    await fillAndSubmit(user, 'Site', 'https://example.com');

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.');
  });

  it('creates the monitor, confirms, and opens its page', async () => {
    const calls = mockApi({
      ...signedIn,
      'POST /monitors': () => [201, { data: makeMonitor({ name: 'Site' }) }],
      [`GET /monitors/${ID}`]: () => [200, { data: { ...makeMonitor({ name: 'Site' }), uptime: { '24h': insufficient, '7d': insufficient, '30d': insufficient } } }],
      [`GET /monitors/${ID}/checks`]: () => [200, { data: [] }],
      [`GET /monitors/${ID}/incidents`]: () => [200, { data: [] }],
    });
    const user = userEvent.setup();
    renderApp('/monitors/new');

    await fillAndSubmit(user, '  Site  ', 'https://example.com');

    expect(await screen.findByRole('heading', { name: 'Site' })).toBeInTheDocument();
    expect(screen.getByText('Now monitoring Site.')).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'POST').body).toEqual({ name: 'Site', url: 'https://example.com' });
  });
});

describe('managing monitors', () => {
  const listRoutes = (monitor, extra = {}) => ({
    ...signedIn,
    'GET /monitors': () => [200, { data: [monitor] }],
    ...extra,
  });

  it('pauses a monitor, confirms, and refreshes', async () => {
    let paused = false;
    const calls = mockApi({
      ...signedIn,
      'GET /monitors': () => [200, { data: [makeMonitor({ paused })] }],
      [`PATCH /monitors/${ID}`]: (body) => {
        paused = body.paused;
        return [200, { data: makeMonitor({ paused }) }];
      },
    });
    const user = userEvent.setup();
    renderApp('/monitors');

    await user.click(await screen.findByRole('button', { name: 'Pause Example' }));

    expect(await screen.findByRole('button', { name: 'Resume Example' })).toBeInTheDocument();
    expect(screen.getByText('Paused Example.')).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'PATCH').body).toEqual({ paused: true });
  });

  it('shows a message when pausing fails, and changes nothing', async () => {
    mockApi(listRoutes(makeMonitor(), {
      [`PATCH /monitors/${ID}`]: () => [500, { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } }],
    }));
    const user = userEvent.setup();
    renderApp('/monitors');

    await user.click(await screen.findByRole('button', { name: 'Pause Example' }));

    expect(await screen.findByText('Something went wrong.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause Example' })).toBeInTheDocument();
  });

  it('does not delete until confirmed', async () => {
    const calls = mockApi(listRoutes(makeMonitor()));
    const user = userEvent.setup();
    renderApp('/monitors');

    await user.click(await screen.findByRole('button', { name: 'Delete Example' }));
    expect(await screen.findByRole('heading', { name: 'Delete Example?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Delete Example?' })).not.toBeInTheDocument());
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
  });

  it('deletes after confirmation', async () => {
    let deleted = false;
    mockApi({
      ...signedIn,
      'GET /monitors': () => [200, { data: deleted ? [] : [makeMonitor()] }],
      [`DELETE /monitors/${ID}`]: () => {
        deleted = true;
        return [204];
      },
    });
    const user = userEvent.setup();
    renderApp('/monitors');

    await user.click(await screen.findByRole('button', { name: 'Delete Example' }));
    await user.click(await screen.findByRole('button', { name: 'Delete monitor' }));

    expect(await screen.findByRole('heading', { name: 'No monitors yet' })).toBeInTheDocument();
    expect(screen.getByText('Deleted Example.')).toBeInTheDocument();
  });

  it('filters by search and status, with its own empty state', async () => {
    mockApi({
      ...signedIn,
      'GET /monitors': () => [200, { data: [makeMonitor({ name: 'Shop' }), makeMonitor({ id: 'b'.repeat(24), name: 'Blog', url: 'https://blog.example.com/', status: 'DOWN' })] }],
    });
    const user = userEvent.setup();
    renderApp('/monitors');

    await user.type(await screen.findByLabelText('Search monitors'), 'blog');
    expect(screen.getByRole('link', { name: 'Blog' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Shop' })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Filter by status'), 'UP');
    expect(screen.getByRole('heading', { name: 'No monitors match' })).toBeInTheDocument();
  });

  it('prefills the edit form and saves only name and URL', async () => {
    const detail = { ...makeMonitor(), uptime: { '24h': insufficient, '7d': insufficient, '30d': insufficient } };
    const calls = mockApi({
      ...signedIn,
      [`GET /monitors/${ID}`]: () => [200, { data: detail }],
      [`PATCH /monitors/${ID}`]: () => [200, { data: makeMonitor({ name: 'Renamed' }) }],
      [`GET /monitors/${ID}/checks`]: () => [200, { data: [] }],
      [`GET /monitors/${ID}/incidents`]: () => [200, { data: [] }],
    });
    const user = userEvent.setup();
    renderApp(`/monitors/${ID}/edit`);

    const name = await screen.findByLabelText('Name');
    expect(name).toHaveValue('Example');
    await user.clear(name);
    await user.type(name, 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByText('Saved Renamed.');
    expect(calls.find((call) => call.method === 'PATCH').body).toEqual({ name: 'Renamed', url: 'https://example.com/' });
  });
});

describe('monitor details', () => {
  const detail = (overrides = {}) => ({
    ...makeMonitor(overrides),
    uptime: {
      '24h': { ...insufficient, status: 'OK', uptimePercent: 99.5, coveragePercent: 100, totalChecks: 1000, failedChecks: 5 },
      '7d': insufficient,
      '30d': insufficient,
    },
  });
  const check = (overrides = {}) => ({
    id: 'c1', checkedAt: new Date().toISOString(), success: true, source: 'SCHEDULED', responseTimeMs: 120, httpStatus: 200, errorCode: null, ...overrides,
  });
  const detailRoutes = (overrides = {}) => ({
    ...signedIn,
    [`GET /monitors/${ID}`]: () => [200, { data: detail() }],
    [`GET /monitors/${ID}/checks`]: () => [200, { data: [check(), check({ id: 'c2', success: false, responseTimeMs: null, httpStatus: 503, errorCode: 'HTTP_STATUS' })] }],
    [`GET /monitors/${ID}/incidents`]: () => [200, { data: [] }],
    ...overrides,
  });

  it('separates real uptime from insufficient data per window', async () => {
    mockApi(detailRoutes());
    renderApp(`/monitors/${ID}`);
    expect(await screen.findByText('99.5%')).toBeInTheDocument();
    expect(screen.getAllByText('Not enough data')).toHaveLength(2);
    expect(screen.getByText('5 failed of 1,000 checks')).toBeInTheDocument();
  });

  it('shows the check history with failures described', async () => {
    mockApi(detailRoutes());
    renderApp(`/monitors/${ID}`);
    expect(await screen.findByText('OK, HTTP 200')).toBeInTheDocument();
    const failedRow = screen.getByText('HTTP 503').closest('tr');
    expect(within(failedRow).getByText('None')).toBeInTheDocument();
  });

  it('describes open and resolved incidents', async () => {
    const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
    mockApi(detailRoutes({
      [`GET /monitors/${ID}/incidents`]: () => [200, { data: [
        { id: 'i1', status: 'OPEN', startedAt: minutesAgo(10), endedAt: null, resolution: null, httpStatus: 503, errorCode: 'HTTP_STATUS' },
        { id: 'i2', status: 'RESOLVED', startedAt: minutesAgo(90), endedAt: minutesAgo(60), resolution: 'RECOVERED', httpStatus: null, errorCode: 'TIMEOUT' },
        { id: 'i3', status: 'RESOLVED', startedAt: minutesAgo(200), endedAt: minutesAgo(190), resolution: 'MONITOR_RESET', httpStatus: null, errorCode: 'TIMEOUT' },
      ] }],
    }));
    renderApp(`/monitors/${ID}`);
    expect(await screen.findByText('Ongoing for 10m')).toBeInTheDocument();
    expect(screen.getByText('Recovered after 30m')).toBeInTheDocument();
    expect(screen.getByText('Closed after 10m because the monitor was paused or edited')).toBeInTheDocument();
  });

  it('runs a manual check and reports the result', async () => {
    mockApi(detailRoutes({
      [`POST /monitors/${ID}/check`]: () => [200, { data: { check: check({ responseTimeMs: 88 }), monitor: makeMonitor(), transition: null } }],
    }));
    const user = userEvent.setup();
    renderApp(`/monitors/${ID}`);

    await user.click(await screen.findByRole('button', { name: 'Run check' }));

    expect(await screen.findByText('Check passed in 88 ms.')).toBeInTheDocument();
  });

  it('reports a failed manual check', async () => {
    mockApi(detailRoutes({
      [`POST /monitors/${ID}/check`]: () => [200, { data: { check: check({ success: false, responseTimeMs: null, httpStatus: null, errorCode: 'TIMEOUT' }), monitor: makeMonitor(), transition: null } }],
    }));
    const user = userEvent.setup();
    renderApp(`/monitors/${ID}`);

    await user.click(await screen.findByRole('button', { name: 'Run check' }));

    expect(await screen.findByText('Check failed: Timed out.')).toBeInTheDocument();
  });

  it('cannot run a check on a paused monitor', async () => {
    mockApi(detailRoutes({ [`GET /monitors/${ID}`]: () => [200, { data: detail({ paused: true }) }] }));
    renderApp(`/monitors/${ID}`);
    expect(await screen.findByRole('button', { name: 'Run check' })).toBeDisabled();
  });

  it('explains a monitor that no longer exists', async () => {
    mockApi(detailRoutes({ [`GET /monitors/${ID}`]: () => [404, { error: { code: 'MONITOR_NOT_FOUND', message: 'Monitor not found.' } }] }));
    renderApp(`/monitors/${ID}`);
    expect(await screen.findByRole('heading', { name: 'Monitor not found' })).toBeInTheDocument();
  });

  it('asks for the selected time range', async () => {
    const urls = [];
    mockApi(detailRoutes());
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      urls.push(String(input));
      return originalFetch(input, init);
    };
    const user = userEvent.setup();
    renderApp(`/monitors/${ID}`);

    await user.click(await screen.findByRole('button', { name: '1 hour' }));

    await waitFor(() => {
      const since = urls.filter((url) => url.includes('/checks')).map((url) => new Date(new URL(url, 'http://x').searchParams.get('since')).getTime());
      expect(Date.now() - Math.max(...since)).toBeLessThan(61 * 60_000);
    });
    expect(screen.getByRole('button', { name: '1 hour' })).toHaveAttribute('aria-pressed', 'true');
  });
});
