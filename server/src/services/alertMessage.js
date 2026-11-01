import { ALERT_TYPE, CHECK_ERROR } from '../config/monitoring.js';

const ERROR_DESCRIPTIONS = {
  [CHECK_ERROR.BLOCKED_TARGET]: 'The address is not allowed by the security policy',
  [CHECK_ERROR.DNS_ERROR]: 'DNS lookup failed',
  [CHECK_ERROR.TIMEOUT]: 'The check timed out',
  [CHECK_ERROR.CONNECTION_ERROR]: 'Could not connect',
  [CHECK_ERROR.TLS_ERROR]: 'TLS certificate or handshake failed',
  [CHECK_ERROR.NETWORK_ERROR]: 'Network error',
};

function describeFailure({ httpStatus, errorCode }) {
  if (httpStatus) return `HTTP ${httpStatus}`;
  return ERROR_DESCRIPTIONS[errorCode] ?? errorCode ?? 'Unknown';
}

function formatDuration(ms) {
  const totalMinutes = Math.max(1, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

/**
 * Builds the email as a pure function. It is plain text, so a monitor name cannot inject
 * markup. Monitored URLs can contain secrets in their query strings, so only the host
 * is included, the same rule the logger follows.
 */
export function buildAlertMessage({ alert, monitor, incident, dashboardUrl }) {
  const name = monitor.name.replace(/\p{Cc}+/gu, ' ');
  const host = new URL(monitor.url).host;
  const link = dashboardUrl ? [`Details: ${dashboardUrl.replace(/\/+$/, '')}/monitors/${monitor._id}`] : [];

  if (alert.type === ALERT_TYPE.DOWN) {
    return {
      subject: `[SitePulse] DOWN: ${name}`,
      text: [
        `${name} (${host}) is down.`,
        '',
        `Since:  ${alert.occurredAt.toUTCString()}`,
        `Reason: ${describeFailure(incident)}`,
        ...link,
      ].join('\n'),
    };
  }

  return {
    subject: `[SitePulse] RECOVERED: ${name}`,
    text: [
      `${name} (${host}) is back up.`,
      '',
      `Down since: ${incident.startedAt.toUTCString()}`,
      `Back up:    ${alert.occurredAt.toUTCString()}`,
      `Outage:     ${formatDuration(alert.occurredAt - incident.startedAt)}`,
      ...link,
    ].join('\n'),
  };
}
