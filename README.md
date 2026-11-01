# SitePulse

A website uptime monitor built on the MERN stack. It checks public HTTP and HTTPS URLs every
60 seconds, records every result, tracks downtime incidents and reports uptime based only on
checks that actually ran.

**Status:** Phases 1 to 3 (backend, monitoring worker, React dashboard, email alerts) are complete.
See [Roadmap](#roadmap).

## Run it locally

You need Node.js 22.19 or newer, and MongoDB (step 2 includes an option that installs nothing
system-wide).

```bash
# 1. Install and configure
cd server
npm install
cp .env.example .env
npm run token            # paste the output into .env as ADMIN_API_TOKEN
npm run token            # paste this different output into .env as SESSION_SECRET
                         # then choose your own ADMIN_PASSWORD (12+ characters) in .env

# 2. Start MongoDB, in its own terminal. This downloads a real mongod on first use
#    and keeps data in server/.dev-db. Skip it if you already have MongoDB running.
npm run db:dev

# 3. Start the API and the monitoring worker, in a second terminal
npm run dev

# 4. Start the dashboard, in a third terminal
cd client
npm install
npm run dev
```

Open <http://localhost:5173> and sign in with `ADMIN_PASSWORD`. Use `localhost`, not `127.0.0.1`:
only the origins in `CORS_ORIGINS` may change data.

You can also use the API directly, with `TOKEN` set to your `ADMIN_API_TOKEN`:

```bash
# Add a monitor. Its first check runs within about a second.
curl -X POST http://127.0.0.1:4000/api/monitors \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Example","url":"https://example.com/"}'

# See it, with its latest status and 24-hour stats
curl http://127.0.0.1:4000/api/monitors -H "Authorization: Bearer $TOKEN"

# This one is refused with BLOCKED_TARGET
curl -X POST http://127.0.0.1:4000/api/monitors \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Metadata","url":"http://169.254.169.254/"}'
```

Run the tests with `npm test` in `server/` or `client/`. They need no `.env`, and the server tests
start their own temporary MongoDB.

## Email alerts

SitePulse emails you once when a site goes DOWN and once when it RECOVERS. Alerts are off until you
set `SMTP_HOST`; monitoring works the same either way, and the API logs a warning at startup.

**To try it without an email account**, run a local mail server that prints each message and never
delivers anything:

```bash
npm run mail:dev         # in its own terminal, from server/
```

Then set these in `server/.env` and restart the API:

```bash
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_SECURITY=none
ALERT_EMAIL_FROM=sitepulse@example.test
ALERT_EMAIL_TO=admin@example.test
```

**To get real email**, use your provider's SMTP settings and an app password if it requires one.
This example is for Gmail, which needs 2-Step Verification and an
[app password](https://myaccount.google.com/apppasswords):

```bash
SMTP_HOST=smtp.gmail.com
SMTP_SECURITY=starttls
SMTP_USER=you@gmail.com
SMTP_PASSWORD=your-app-password
ALERT_EMAIL_FROM=you@gmail.com
ALERT_EMAIL_TO=you@gmail.com     # a comma-separated list also works
```

Run `npm run alert:test` to send a test email, so you find a problem with the settings before an
outage does. The server refuses to start if the settings are incomplete, or if `SMTP_SECURITY=none`
points at another machine.

If an email cannot be sent, the overview page says so, with the reason: from the first failed attempt
while retries remain, and for 7 days after the last retry fails. There is no button to dismiss these;
they clear when a retry succeeds or the 7 days pass.

## Recording a demo video

`studio/` is a small local page that records your screen, your camera and your voice into one video
(screen on the left, camera on the right), with the presentation script beside you where viewers
cannot see it. You need Chrome, and [ffmpeg](https://ffmpeg.org/download.html) for the final MP4.
Without ffmpeg you still get a `.webm` file.

1. Get SitePulse running with the steps above, and use the local mail settings under
   [Email alerts](#email-alerts), with `npm run mail:dev` in its own terminal.
2. Add a few monitors, including one that fails on purpose, named `Failing demo`:
   `https://httpbin.org/status/500`. It shows as Down after 3 checks, about 3 minutes.
3. Run `node studio/server.mjs` in its own terminal and open <http://localhost:5199> in Chrome.
4. Put that window on the right of the screen, about a quarter of its width, and everything you
   want to show on the left. The preview shows exactly what will be recorded.
5. Choose your entire screen when asked, then click **Record**.

Videos are saved in the `Videos` folder of your home directory.

## API

Every `/api` route except `/api/auth/*` needs either the header
`Authorization: Bearer <ADMIN_API_TOKEN>` or a dashboard session cookie.

| Method and path | Purpose |
| --- | --- |
| `GET /health` | Public health check, needs no token |
| `POST /api/auth/login` | Dashboard sign-in: `{ password }` |
| `POST /api/auth/logout` | Dashboard sign-out |
| `GET /api/auth/session` | Whether this browser is signed in |
| `GET /api/monitors` | List monitors with 24-hour uptime |
| `POST /api/monitors` | Create: `{ name, url, paused? }` |
| `GET /api/monitors/:id` | One monitor with 24h, 7d and 30d uptime |
| `PATCH /api/monitors/:id` | Edit, pause or resume: `{ name?, url?, paused? }` |
| `DELETE /api/monitors/:id` | Delete a monitor and its history |
| `GET /api/monitors/:id/checks` | History: `?limit=&before=&since=` (dates are ISO 8601) |
| `POST /api/monitors/:id/check` | Run a check now |
| `GET /api/monitors/:id/incidents` | Incidents: `?limit=&status=OPEN\|RESOLVED` |
| `GET /api/dashboard/summary` | Counts, overall uptime, recent incidents, undelivered alerts |

Successful responses look like `{ "data": ... }`. Every error has the same shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "The request is not valid.", "details": [] } }
```

## Project structure

```text
server/
  src/
    server.js           Process entry point: starts the app, handles shutdown signals
    bootstrap.js        Startup order: MongoDB, then scheduler, then HTTP
    app.js              Express app and middleware, with no port and no database
    config/             Environment validation, DB connection, monitoring rules
    security/
      ipPolicy.js       Is this IP address public?
      targetPolicy.js   Is this URL allowed? Resolves DNS and approves addresses
    models/             Monitor, CheckResult, Incident, Alert
    routes/             URLs mapped to validators and controllers
    validators/         Request schemas (zod)
    controllers/        HTTP in, HTTP out, no business logic
    services/
      httpCheck.js      One safe outbound HTTP check
      monitorState.js   DOWN/UP rules as a pure function
      checkService.js   Locking and saving results
      checkRunner.js    Concurrency limit, shared by scheduled and manual checks
      alertService.js   The alert queue: add, claim, retry, cancel
      alertDispatcher.js  Sends queued alerts, separately from checks
      alertMessage.js   The email's text as a pure function
      mailer.js         SMTP connection settings
      incidentService.js, statsService.js, monitorService.js, dashboardService.js
    jobs/
      monitorScheduler.js  The cron heartbeat for checks
      alertScheduler.js    The cron heartbeat for alerts
    middleware/         Auth, validation, error handling
  scripts/
    dev-db.js           Local MongoDB for development
    dev-mail.js         Local mail server for development
    send-test-alert.js  Sends one email to test the SMTP settings
  tests/
client/
  src/
    main.jsx, App.jsx   Startup and page routes
    api/client.js       Every API call, and turning failures into ApiError
    context/            Signed-in state, toast messages
    hooks/useResource.js  Loading, errors, polling and stale-response protection
    lib/                Formatting and chart data, as plain testable functions
    components/         Sidebar layout, cards, chart, forms, dialogs, shared states
    pages/              Overview, monitors, monitor details, add/edit, login
  tests/
```

A request travels **route, then validator, then controller, then service, then model**. Each layer
has one job, so you can test the rules without HTTP and change the API without touching the rules.

## How a check works

1. Every second, each worker asks MongoDB for a monitor that is due and not locked.
2. An atomic `findOneAndUpdate` claims it, so only one worker can win.
3. `httpCheck.js` validates the URL, resolves DNS, validates every address, and connects only to
   those addresses.
4. `recordCheckOutcome` saves the result, but only if this worker still holds the lock.
5. `nextMonitorState` applies the rules, and incidents are updated to match.
6. Any alert this causes joins a queue in MongoDB, and a separate job emails it within about 5 seconds.

## Key decisions

### Why undici instead of native `fetch`

The standard `fetch` API has no way to choose the IP address it connects to. It does its own DNS
lookup when connecting, after any validation you did. That gap is what DNS rebinding exploits: a
hostile DNS server answers with a public IP during validation and `127.0.0.1` a moment later.

[undici](https://github.com/nodejs/undici) is the library behind Node's own `fetch`, maintained by
the Node.js project. Its `Agent` lets us replace the DNS step with a function that only returns
the approved addresses. Node's `fetch` can accept an undici agent through a non-standard option, but
that ties together Node's bundled undici and the installed one, so calling undici directly is
simpler and more dependable. `AbortSignal.timeout` is still used as you specified. Certificates are
still verified against the host name, so pinning does not weaken HTTPS.

### SSRF protection

| Requirement | How it is met |
| --- | --- |
| HTTP and HTTPS only | Protocol allowlist in `parseTargetUrl` |
| No credentials in URLs | Rejected in `parseTargetUrl` |
| Private, loopback, reserved and similar ranges | Allowlist in `ipPolicy.js`, IPv4 and IPv6 |
| All DNS answers validated | One bad record blocks the host |
| DNS rebinding | Each check connects only to the addresses it validated |
| Redirects disabled | undici's `request` does not follow them; a 3xx counts as success |
| Timeouts | One deadline covers DNS, connect, TLS, headers and body |
| Size limits | Body reading stops at the limit; response headers are capped at 32 KiB |
| Concurrency limit | `CheckRunner`, per worker process |
| Manual and scheduled checks | Both use the same `CheckRunner` and `performHttpCheck` |
| Admin only | Bearer token or signed session on all data routes, including reads |

The IP check is an **allowlist**: an address must be positively identified as public. This matters
in practice, because ipaddr.js labels `::7f00:1` (an old IPv6 spelling of `127.0.0.1`) as ordinary
unicast. IPv6 is therefore limited to global unicast `2000::/3` minus the special `2001::/23` block.

There is no setting that disables the policy. Tests replace it through a function parameter, which
a deployment cannot reach.

### Locking across workers

The lock lives in the monitor's document, so multiple workers need nothing beyond MongoDB:

- **Atomic claim:** only one worker can move a monitor to "locked".
- **Lease:** a lock expires, so a crashed worker cannot hold a monitor forever.
- **Fencing token:** each claim gets a random token, and the result only saves if the token still
  matches. A worker that lost its lease, or whose monitor was edited mid-check, has its result
  dropped instead of overwriting newer data.

### Why no MongoDB transactions

Transactions require a replica set, which would complicate local setup. Instead the writes are
ordered so that a crash leaves something repairable, and incident writes are idempotent. The next
check corrects any mismatch. A partial unique index guarantees one open incident per monitor.

### How alerts avoid duplicates and losses

Alerts are saved to MongoDB first and sent afterwards, rather than emailed during a check. A slow mail
server therefore cannot delay monitoring, and a restart does not lose an unsent alert.

- **One per outage:** a unique index allows one alert of each type per incident, however many workers,
  retries or restarts try to create it. A site that stays down does not email you again.
- **Crash repair:** the same repair pass that fixes incidents after every check also queues any
  missing alert. A recovery alert is queued before its incident closes, so a crash in between cannot
  lose it.
- **One sender at a time:** each alert is claimed atomically with a lease, the same way monitors are.
- **Retries:** a failed send is retried after 1, 5, 15, 60 and 180 minutes, then marked `FAILED` and
  logged as an error.
- **No secrets in email:** messages name the host only, because URLs can hold secrets in their query
  strings. They are plain text, so a monitor name cannot inject markup.

Delivery is **at least once**, because email offers nothing stronger. If a worker crashes after the
mail server accepts a message but before saving that fact, the alert is sent again once its lease
expires. Each alert keeps a fixed `Message-ID`, which lets mail systems recognize the repeat. A rare
repeat is the better failure, since the alternative is a rare missed outage.

### Uptime that does not flatter

Uptime is `successful checks / recorded checks`, so time nobody was watching never counts as up.
Coverage is reported beside it. If checks span less than 50% of a window, `uptimePercent` is `null`
and `status` is `INSUFFICIENT_DATA`, so a one-hour-old monitor does not claim "100% over 30 days".

### How the dashboard signs in

The API token must never reach browser code, because anything in the frontend bundle is public.
So the dashboard signs in with `ADMIN_PASSWORD`, and the server replies with a session cookie:

- **`HttpOnly`:** JavaScript cannot read it, so a script injected into the page cannot steal it.
- **`SameSite=Strict` plus an origin check:** other websites cannot make the browser act for you.
- **`Secure` in production:** it is only sent over HTTPS.
- **Signed with an expiry:** the browser cannot forge or extend it. Sessions last 12 hours.
- **Failed logins are limited** to 10 per 15 minutes, per IP address and per server process.

The frontend's route guard is only a convenience for showing the right page. The real protection
is the server checking every request.

Sessions are not stored on the server, which keeps the design simple. The trade-off is that signing
out clears the cookie in that browser but cannot cancel a stolen copy before it expires. Changing
`ADMIN_PASSWORD` or `SESSION_SECRET` signs everyone out at once.

### How the dashboard stays honest

- **It shows only API data.** There is no placeholder data anywhere in the frontend.
- **Failed refreshes keep the last data on screen with a warning**, rather than blanking the page.
- **The chart's x-axis always spans the full selected range**, and time with no checks breaks the
  line, so a gap in monitoring cannot look like a steady period.
- **Failed checks stay off the response-time line.** Consecutive failures draw as a shaded band whose
  width matches the outage.
- **Every status has an icon and a word**, so nothing depends on seeing color.

The dashboard refreshes every 30 seconds while the tab is visible, and every 3 seconds while a new
monitor waits for its first result.

### Choices worth reviewing

These are not spelled out in the spec:

- **A response over the size limit still counts as success.** The status is already known, and a
  large homepage is not an outage. The check records `bodyTruncated: true`.
- **Pausing or changing a URL resets the monitor** to `PENDING` and closes any open incident with
  `MONITOR_RESET`, because nobody observed a recovery. No recovery alert will be sent for these.
- **Incident times use the first failure and first success**, not the third and second, so a
  recorded outage reflects when it actually started and ended.
- **A manual check counts as a real observation** and feeds the DOWN/UP rules. Three failing manual
  checks in a row can mark a site DOWN.
- **An unsent DOWN alert is cancelled once the outage ends**, because "it is down" would no longer be
  true. The recovery email still reports the outage and how long it lasted.
- **Turning email on during an outage sends one DOWN alert for it**, because it is still happening.
  Outages that ended while email was off are never emailed.
- **Checks are kept for 35 days**, enough for the 30-day window, then deleted automatically.
- **Overall 24-hour uptime counts every active monitor.** Adding a new site can briefly change the
  overview's figure to "Not enough data", because the new site has no history in that window.

## Known limitations

- **There is one admin account**, with no individual users or roles.
- **All alerts go to the same recipients.** They cannot be set per monitor or turned off for one site.
- **The production frontend is not hosted yet.** `npm run build` creates `client/dist`, but the
  deployment setup, such as serving it from the same origin as the API, is still to be chosen.
- **Dark mode follows the operating system.** There is no in-app switch.
- **Changing a monitor's URL keeps old checks**, so its uptime figures mix both targets until the
  old checks leave the window.
- **The concurrency limit is per process.** Total outbound checks scale with the number of workers.
- **The rate limiters count per process and in memory.** Multiple API instances would need a shared
  store.
- **Public ports are not restricted.** The admin can monitor any port on a public host.

## Roadmap

1. **Backend, models, worker (done)**
2. **React frontend: dashboard, monitor details, charts, admin login (done)**
3. **Email alerts on DOWN and RECOVERED, with duplicate protection (done)**
4. Final test pass and documentation

Nothing is deployed, and no paid service is needed to run this locally.
