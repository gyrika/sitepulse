const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatRelativeTime(value, now = Date.now()) {
  if (!value) return 'Never';
  const elapsed = now - new Date(value).getTime();
  if (elapsed < 45_000) return 'Just now';
  if (elapsed < HOUR) return `${Math.max(1, Math.round(elapsed / MINUTE))} min ago`;
  if (elapsed < DAY) return `${Math.round(elapsed / HOUR)} hr ago`;
  return `${Math.round(elapsed / DAY)} d ago`;
}

export function formatDateTime(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function formatTimeWithSeconds(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

export function formatAxisTime(value) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

export function formatDuration(milliseconds) {
  const totalMinutes = Math.round(milliseconds / MINUTE);
  if (totalMinutes < 1) return 'Under a minute';
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  return [days && `${days}d`, hours && `${hours}h`, minutes && `${minutes}m`].filter(Boolean).join(' ');
}

export function formatMs(value) {
  return value === null || value === undefined ? 'None' : `${value.toLocaleString()} ms`;
}

// null means the backend decided there is not enough data, so nothing is invented here.
export function formatUptime(stat) {
  return stat?.uptimePercent === null || stat?.uptimePercent === undefined ? 'Not enough data' : `${stat.uptimePercent}%`;
}

export function formatCoverage(stat) {
  const percent = stat?.coveragePercent ?? 0;
  return percent > 0 && percent < 0.1 ? 'Under 0.1% monitored' : `${percent.toFixed(1)}% monitored`;
}

export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const ERROR_LABELS = {
  BLOCKED_TARGET: 'Blocked address',
  DNS_ERROR: 'DNS failure',
  TIMEOUT: 'Timed out',
  CONNECTION_ERROR: 'Connection failed',
  TLS_ERROR: 'TLS error',
  NETWORK_ERROR: 'Network error',
};

export function describeFailure({ errorCode, httpStatus }) {
  if (httpStatus) return `HTTP ${httpStatus}`;
  return ERROR_LABELS[errorCode] ?? 'Failed';
}
