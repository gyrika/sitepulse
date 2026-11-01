import { CheckCircle2, Clock, PauseCircle, XCircle } from 'lucide-react';

// Every status has an icon and a word, so nothing depends on seeing color.
const STATUSES = {
  UP: { label: 'Up', icon: CheckCircle2, color: 'text-good' },
  DOWN: { label: 'Down', icon: XCircle, color: 'text-critical' },
  PENDING: { label: 'Pending', icon: Clock, color: 'text-neutral' },
  PAUSED: { label: 'Paused', icon: PauseCircle, color: 'text-neutral' },
};

export function displayStatus(monitor) {
  return monitor.paused ? 'PAUSED' : monitor.status;
}

export function StatusBadge({ monitor }) {
  const { label, icon: Icon, color } = STATUSES[displayStatus(monitor)];
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap">
      <Icon aria-hidden="true" className={`size-4 ${color}`} />
      {label}
    </span>
  );
}
