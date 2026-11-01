import { CheckCircle2, Clock, Globe, Plus, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client.js';
import { AlertDeliveryNotice } from '../components/AlertDeliveryNotice.jsx';
import { IncidentList } from '../components/IncidentList.jsx';
import { MonitorCard } from '../components/MonitorCard.jsx';
import { RangePicker } from '../components/RangePicker.jsx';
import { LazyResponseTimeChart } from '../components/LazyResponseTimeChart.jsx';
import { StatTile } from '../components/StatTile.jsx';
import { displayStatus } from '../components/StatusBadge.jsx';
import {
  buttonClass,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StaleDataNotice,
  TextLink,
} from '../components/ui.jsx';
import { useResource } from '../hooks/useResource.js';
import { CHART_RANGES } from '../lib/chartData.js';
import { formatCoverage, formatMs, formatUptime } from '../lib/format.js';

const POLL_MS = 30_000;
const STATUS_ORDER = { DOWN: 0, PENDING: 1, UP: 2, PAUSED: 3 };

function StatusSummary({ monitors }) {
  const pendingNoun = monitors.pending === 1 ? 'site is' : 'sites are';
  let tone = {
    icon: Clock,
    color: 'text-neutral',
    wash: 'bg-hover',
    text: `${monitors.pending} ${pendingNoun} waiting for a confirmed status.`,
  };
  if (monitors.down > 0) {
    const noun = monitors.down === 1 ? 'site is' : 'sites are';
    tone = { icon: XCircle, color: 'text-critical', wash: 'bg-critical-wash', text: `${monitors.down} ${noun} down.` };
  } else if (monitors.up > 0 && monitors.pending === 0) {
    tone = { icon: CheckCircle2, color: 'text-good', wash: 'bg-good-wash', text: 'All monitored sites are up.' };
  } else if (monitors.total > 0 && monitors.paused === monitors.total) {
    tone = { icon: Clock, color: 'text-neutral', wash: 'bg-hover', text: 'All monitors are paused.' };
  }
  const Icon = tone.icon;
  return (
    <div className={`mb-6 flex items-center gap-2.5 rounded-xl px-4 py-3 font-medium ${tone.wash}`}>
      <Icon aria-hidden="true" className={`size-5 shrink-0 ${tone.color}`} />
      {tone.text}
    </div>
  );
}

function ResponseTimeSection({ monitors }) {
  const [rangeKey, setRangeKey] = useState('24h');
  const [selectedId, setSelectedId] = useState(null);

  // Start with the monitor most likely to matter. Paused ones have no recent data.
  const monitorId = useMemo(() => {
    if (monitors.some((monitor) => monitor.id === selectedId)) return selectedId;
    return monitors[0]?.id ?? null;
  }, [monitors, selectedId]);

  const range = CHART_RANGES.find((option) => option.key === rangeKey);
  const checks = useResource(
    async () => {
      const to = Date.now();
      const from = to - range.ms;
      const rows = await api.listChecks(monitorId, { limit: 1500, since: new Date(from).toISOString() });
      return { rows, from, to };
    },
    [monitorId, rangeKey],
    { pollMs: POLL_MS },
  );

  return (
    <section aria-labelledby="response-time-heading" className="mb-8">
      <h2 id="response-time-heading" className="mb-3 font-semibold">Response time</h2>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex min-w-0 items-center gap-2 text-sm">
          <span className="sr-only">Monitor</span>
          <select
            value={monitorId ?? ''}
            onChange={(event) => setSelectedId(event.target.value)}
            className="min-h-10 max-w-full min-w-0 rounded-lg border border-line bg-surface px-3 text-sm"
          >
            {monitors.map((monitor) => (
              <option key={monitor.id} value={monitor.id}>{monitor.name}</option>
            ))}
          </select>
        </label>
        <RangePicker value={rangeKey} onChange={setRangeKey} />
      </div>
      <Card className="p-4">
        {checks.loading ? <LoadingState label="Loading checks" /> : null}
        {!checks.loading && checks.error && !checks.data ? <ErrorState error={checks.error} onRetry={checks.reload} /> : null}
        {checks.data ? (
          <LazyResponseTimeChart checks={checks.data.rows} from={checks.data.from} to={checks.data.to} dimmed={checks.refreshing} />
        ) : null}
      </Card>
    </section>
  );
}

export function OverviewPage() {
  const summary = useResource(api.getSummary, [], { pollMs: POLL_MS });
  const monitors = useResource(api.listMonitors, [], { pollMs: POLL_MS });

  const sortedMonitors = useMemo(
    () =>
      [...(monitors.data ?? [])].sort(
        (a, b) => STATUS_ORDER[displayStatus(a)] - STATUS_ORDER[displayStatus(b)] || a.name.localeCompare(b.name),
      ),
    [monitors.data],
  );

  const retry = () => {
    summary.reload();
    monitors.reload();
  };

  const header = <PageHeader title="Overview" description="Live status of your monitored websites." />;

  if (summary.loading || monitors.loading) {
    return (
      <>
        {header}
        <LoadingState label="Loading dashboard" />
      </>
    );
  }

  if (!summary.data || !monitors.data) {
    return (
      <>
        {header}
        <Card><ErrorState error={summary.error ?? monitors.error} onRetry={retry} title="The dashboard could not be loaded" /></Card>
      </>
    );
  }

  if (sortedMonitors.length === 0) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon={Globe}
            title="No websites monitored yet"
            description="Add your first website and SitePulse will start checking it every 60 seconds."
            action={
              <Link to="/monitors/new" className={buttonClass('primary')}>
                <Plus aria-hidden="true" className="size-4" />
                Add monitor
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  const { monitors: counts, openIncidents, uptime24h, recentIncidents, alertDelivery } = summary.data;
  const active = counts.total - counts.paused;
  const chartableMonitors = sortedMonitors.filter((monitor) => !monitor.paused);

  return (
    <>
      {header}
      <StaleDataNotice error={summary.error ?? monitors.error} onRetry={retry} />
      <StatusSummary monitors={counts} />
      <AlertDeliveryNotice delivery={alertDelivery} />

      <section aria-label="Key statistics" className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Sites up"
          value={`${counts.up} of ${active}`}
          detail={counts.paused > 0 ? `${counts.paused} paused` : 'Active monitors'}
        />
        <StatTile
          label="Open incidents"
          value={openIncidents}
          detail={counts.pending > 0 ? `${counts.pending} awaiting confirmed status` : 'Right now'}
        />
        <StatTile label="Uptime, 24h" value={formatUptime(uptime24h)} detail={formatCoverage(uptime24h)} />
        <StatTile
          label="Average response, 24h"
          value={uptime24h.avgResponseTimeMs === null ? 'No data' : formatMs(uptime24h.avgResponseTimeMs)}
          detail={`From ${uptime24h.totalChecks.toLocaleString()} checks`}
        />
      </section>

      {chartableMonitors.length > 0 ? <ResponseTimeSection monitors={chartableMonitors} /> : null}

      <section aria-labelledby="websites-heading" className="mb-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="websites-heading" className="font-semibold">Websites</h2>
          <TextLink to="/monitors">Manage monitors</TextLink>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {sortedMonitors.map((monitor) => (
            <MonitorCard key={monitor.id} monitor={monitor} />
          ))}
        </div>
      </section>

      <section aria-labelledby="incidents-heading">
        <h2 id="incidents-heading" className="mb-3 font-semibold">Recent incidents</h2>
        <Card><IncidentList incidents={recentIncidents} showMonitor /></Card>
      </section>
    </>
  );
}
