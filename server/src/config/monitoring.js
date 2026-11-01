// Product rules for monitoring. These are constants, not environment variables,
// because changing them changes what "UP", "DOWN" and "99.9%" mean.

export const CHECK_INTERVAL_MS = 60_000;
export const FAILURES_BEFORE_DOWN = 3;
export const SUCCESSES_BEFORE_UP = 2;

export const MIN_SUCCESS_STATUS = 200;
export const MAX_SUCCESS_STATUS = 399;

// Every second, workers look for due monitors. A check is therefore at most about
// one second late, so the real cadence stays close to CHECK_INTERVAL_MS.
export const SCHEDULER_CRON = '* * * * * *';

// How long a worker owns a monitor while checking it. It must outlast the slowest
// check, otherwise a second worker could start checking the same monitor.
export const LOCK_LEASE_TIMEOUT_MULTIPLIER = 3;

// Uptime is only reported when at least this share of the window has recorded checks.
export const MIN_UPTIME_COVERAGE = 0.5;

// Slightly longer than the largest uptime window (30 days).
export const CHECK_RETENTION_DAYS = 35;

export const MONITOR_STATUS = Object.freeze({ PENDING: 'PENDING', UP: 'UP', DOWN: 'DOWN' });
export const STATE_TRANSITION = Object.freeze({ DOWN: 'DOWN', RECOVERED: 'RECOVERED' });
export const INCIDENT_STATUS = Object.freeze({ OPEN: 'OPEN', RESOLVED: 'RESOLVED' });
export const INCIDENT_RESOLUTION = Object.freeze({
  RECOVERED: 'RECOVERED',
  // The admin paused the monitor or changed its URL, so the outcome is unknown.
  MONITOR_RESET: 'MONITOR_RESET',
});
export const CHECK_SOURCE = Object.freeze({ SCHEDULED: 'SCHEDULED', MANUAL: 'MANUAL' });

export const ALERT_CRON = '*/5 * * * * *';
// Must outlast one send, including the mail server timeouts in mailer.js.
export const ALERT_LEASE_MS = 5 * 60_000;
// One delay per retry, so an alert gets six attempts over a little more than four hours.
export const ALERT_RETRY_DELAYS_MS = Object.freeze([60_000, 300_000, 900_000, 3_600_000, 10_800_000]);

// How long the dashboard keeps showing an alert that was never delivered.
export const ALERT_FAILURE_VISIBLE_DAYS = 7;

export const ALERT_TYPE = Object.freeze({ DOWN: 'DOWN', RECOVERED: 'RECOVERED' });
export const ALERT_STATUS = Object.freeze({
  PENDING: 'PENDING',
  SENT: 'SENT',
  // Every attempt failed.
  FAILED: 'FAILED',
  // No longer worth sending: the outage ended first, or the monitor was reset or deleted.
  CANCELLED: 'CANCELLED',
});
export const SMTP_SECURITY = Object.freeze({ STARTTLS: 'starttls', TLS: 'tls', NONE: 'none' });

export const CHECK_ERROR = Object.freeze({
  BLOCKED_TARGET: 'BLOCKED_TARGET',
  DNS_ERROR: 'DNS_ERROR',
  TIMEOUT: 'TIMEOUT',
  CONNECTION_ERROR: 'CONNECTION_ERROR',
  TLS_ERROR: 'TLS_ERROR',
  HTTP_STATUS: 'HTTP_STATUS',
  NETWORK_ERROR: 'NETWORK_ERROR',
});
