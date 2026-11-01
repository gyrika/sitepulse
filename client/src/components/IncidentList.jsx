import { CheckCircle2, ShieldCheck, XCircle } from 'lucide-react';
import { Link } from 'react-router';
import { describeFailure, formatDateTime, formatDuration } from '../lib/format.js';
import { EmptyState } from './ui.jsx';

function describeOutcome(incident, now) {
  if (incident.status === 'OPEN') {
    return `Ongoing for ${formatDuration(now - new Date(incident.startedAt).getTime())}`;
  }
  const duration = formatDuration(new Date(incident.endedAt) - new Date(incident.startedAt));
  return incident.resolution === 'RECOVERED'
    ? `Recovered after ${duration}`
    : `Closed after ${duration} because the monitor was paused or edited`;
}

export function IncidentList({ incidents, showMonitor = false }) {
  if (incidents.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No incidents recorded"
        description="An incident opens when a site fails 3 checks in a row."
      />
    );
  }

  const now = Date.now();
  return (
    <ul className="divide-y divide-line">
      {incidents.map((incident) => {
        const open = incident.status === 'OPEN';
        const Icon = open ? XCircle : CheckCircle2;
        return (
          <li key={incident.id} className="flex items-start gap-3 p-4">
            <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${open ? 'text-critical' : 'text-neutral'}`} />
            <div className="min-w-0 flex-1 text-sm">
              {showMonitor && incident.monitor ? (
                <Link to={`/monitors/${incident.monitor.id}`} className="font-medium break-words hover:underline">
                  {incident.monitor.name}
                </Link>
              ) : null}
              <p className={showMonitor ? 'text-ink-secondary' : 'font-medium'}>{describeOutcome(incident, now)}</p>
              <p className="text-xs text-ink-secondary">
                Started {formatDateTime(incident.startedAt)} · {describeFailure(incident)}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
