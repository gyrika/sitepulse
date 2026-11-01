import { AlertTriangle } from 'lucide-react';
import { Link } from 'react-router';
import { formatCoverage, formatMs, formatRelativeTime, formatUptime, hostOf } from '../lib/format.js';
import { StatusBadge } from './StatusBadge.jsx';

function Metric({ label, value, detail }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-secondary">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{value}</dd>
      {detail ? <dd className="text-xs text-ink-secondary">{detail}</dd> : null}
    </div>
  );
}

// A site can be failing without being DOWN yet, which is worth seeing early.
export function FailureStreakNote({ monitor }) {
  if (monitor.paused || monitor.status === 'DOWN' || monitor.consecutiveFailures === 0) return null;
  const count = monitor.consecutiveFailures;
  return (
    <p className="flex items-center gap-1.5 text-xs text-ink-secondary">
      <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0 text-warning" />
      {count} failed {count === 1 ? 'check' : 'checks'} in a row
    </p>
  );
}

export function MonitorCard({ monitor }) {
  const { uptime24h } = monitor;
  return (
    <Link
      to={`/monitors/${monitor.id}`}
      className="block min-w-0 rounded-xl border border-line bg-surface p-4 transition-colors hover:bg-hover"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium">{monitor.name}</h3>
          <p className="truncate text-sm text-ink-secondary">{hostOf(monitor.url)}</p>
        </div>
        <StatusBadge monitor={monitor} />
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3">
        <Metric
          label="Uptime, 24h"
          value={formatUptime(uptime24h)}
          detail={uptime24h?.status === 'INSUFFICIENT_DATA' ? formatCoverage(uptime24h) : null}
        />
        <Metric label="Response" value={formatMs(monitor.lastResponseTimeMs)} />
        <Metric label="Last check" value={formatRelativeTime(monitor.lastCheckedAt)} />
      </dl>

      <div className="mt-3 empty:hidden">
        <FailureStreakNote monitor={monitor} />
      </div>
    </Link>
  );
}
