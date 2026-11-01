import { Globe, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client.js';
import { FailureStreakNote } from '../components/MonitorCard.jsx';
import { MonitorActions } from '../components/MonitorActions.jsx';
import { displayStatus, StatusBadge } from '../components/StatusBadge.jsx';
import {
  buttonClass,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StaleDataNotice,
} from '../components/ui.jsx';
import { useResource } from '../hooks/useResource.js';
import { formatMs, formatRelativeTime, formatUptime } from '../lib/format.js';

const POLL_MS = 30_000;
const STATUS_FILTERS = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'UP', label: 'Up' },
  { value: 'DOWN', label: 'Down' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'PAUSED', label: 'Paused' },
];

export function MonitorsPage() {
  const { data, error, loading, reload } = useResource(api.listMonitors, [], { pollMs: POLL_MS });
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data ?? []).filter((monitor) => {
      const matchesQuery = !needle || monitor.name.toLowerCase().includes(needle) || monitor.url.toLowerCase().includes(needle);
      const matchesStatus = statusFilter === 'ALL' || displayStatus(monitor) === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [data, query, statusFilter]);

  const header = (
    <PageHeader
      title="Monitors"
      description="Add, edit, pause and remove monitored websites."
      actions={
        <Link to="/monitors/new" className={buttonClass('primary')}>
          <Plus aria-hidden="true" className="size-4" />
          Add monitor
        </Link>
      }
    />
  );

  if (loading) {
    return (
      <>
        {header}
        <LoadingState label="Loading monitors" />
      </>
    );
  }

  if (!data) {
    return (
      <>
        {header}
        <Card><ErrorState error={error} onRetry={reload} title="Monitors could not be loaded" /></Card>
      </>
    );
  }

  if (data.length === 0) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon={Globe}
            title="No monitors yet"
            description="Add a public website to start checking it every 60 seconds."
          />
        </Card>
      </>
    );
  }

  return (
    <>
      {header}
      <StaleDataNotice error={error} onRetry={reload} />

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative min-w-52 flex-1 sm:max-w-sm">
          <Search aria-hidden="true" className="pointer-events-none absolute top-3 left-3 size-4 text-ink-muted" />
          <input
            type="search"
            aria-label="Search monitors"
            placeholder="Search monitors"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-h-10 w-full rounded-lg border border-line bg-surface pr-3 pl-9 text-sm placeholder:text-ink-muted"
          />
        </div>
        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className="min-h-10 rounded-lg border border-line bg-surface px-3 text-sm"
        >
          {STATUS_FILTERS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <Card><EmptyState icon={Search} title="No monitors match" description="Try a different search or status." /></Card>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {filtered.map((monitor) => (
              <li key={monitor.id} className="flex flex-col gap-3 p-4 xl:flex-row xl:items-center xl:gap-6">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3 xl:justify-start">
                    <Link to={`/monitors/${monitor.id}`} className="min-w-0 truncate font-medium hover:underline">
                      {monitor.name}
                    </Link>
                    <StatusBadge monitor={monitor} />
                  </div>
                  <p className="truncate text-sm text-ink-secondary">{monitor.url}</p>
                  <p className="mt-1 text-xs text-ink-secondary">
                    Uptime, 24h: {formatUptime(monitor.uptime24h)} · Response: {formatMs(monitor.lastResponseTimeMs)} · Checked{' '}
                    {formatRelativeTime(monitor.lastCheckedAt).toLowerCase()}
                  </p>
                  <div className="mt-1 empty:hidden">
                    <FailureStreakNote monitor={monitor} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <MonitorActions monitor={monitor} onChanged={reload} onDeleted={reload} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
