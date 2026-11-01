import { ArrowLeft, History, SearchX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api/client.js';
import { CheckHistoryTable } from '../components/CheckHistoryTable.jsx';
import { IncidentList } from '../components/IncidentList.jsx';
import { FailureStreakNote } from '../components/MonitorCard.jsx';
import { MonitorActions } from '../components/MonitorActions.jsx';
import { RangePicker } from '../components/RangePicker.jsx';
import { LazyResponseTimeChart } from '../components/LazyResponseTimeChart.jsx';
import { StatTile } from '../components/StatTile.jsx';
import { StatusBadge } from '../components/StatusBadge.jsx';
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StaleDataNotice,
  TextLink,
} from '../components/ui.jsx';
import { useResource } from '../hooks/useResource.js';
import { CHART_RANGES, summarizeChecks } from '../lib/chartData.js';
import { formatCoverage, formatMs, formatRelativeTime, formatUptime } from '../lib/format.js';

const POLL_MS = 30_000;
const FIRST_CHECK_POLL_MS = 3_000;

function uptimeDetail(stat) {
  if (stat.status === 'OK') return `${stat.failedChecks.toLocaleString()} failed of ${stat.totalChecks.toLocaleString()} checks`;
  return formatCoverage(stat);
}

export function MonitorDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [rangeKey, setRangeKey] = useState('24h');
  const range = CHART_RANGES.find((option) => option.key === rangeKey);

  const monitor = useResource(() => api.getMonitor(id), [id], { pollMs: POLL_MS });
  const incidents = useResource(() => api.listIncidents(id, { limit: 20 }), [id], { pollMs: POLL_MS });
  const checks = useResource(
    async () => {
      const to = Date.now();
      const from = to - range.ms;
      const rows = await api.listChecks(id, { limit: 1500, since: new Date(from).toISOString() });
      return { rows, from, to };
    },
    [id, rangeKey],
    { pollMs: POLL_MS },
  );

  const reloadAll = () => Promise.all([monitor.reload(), incidents.reload(), checks.reload()]);

  // A new monitor gets its first result within seconds, so don't wait for the normal poll.
  const awaitingFirstCheck = monitor.data && !monitor.data.paused && !monitor.data.lastCheckedAt;
  useEffect(() => {
    if (!awaitingFirstCheck) return undefined;
    const timer = setInterval(reloadAll, FIRST_CHECK_POLL_MS);
    return () => clearInterval(timer);
  }, [awaitingFirstCheck]);

  const backLink = (
    <Link to="/monitors" className="mb-1 inline-flex min-h-10 items-center gap-1.5 rounded text-sm text-ink-secondary hover:text-ink">
      <ArrowLeft aria-hidden="true" className="size-4" />
      Monitors
    </Link>
  );

  if (monitor.loading) return <LoadingState label="Loading monitor" />;

  if (!monitor.data) {
    return (
      <>
        {backLink}
        <Card>
          {monitor.error?.code === 'MONITOR_NOT_FOUND' ? (
            <EmptyState icon={SearchX} title="Monitor not found" description="It may have been deleted." action={<TextLink to="/monitors">Back to monitors</TextLink>} />
          ) : (
            <ErrorState error={monitor.error} onRetry={monitor.reload} title="This monitor could not be loaded" />
          )}
        </Card>
      </>
    );
  }

  const site = monitor.data;
  const rangeSummary = checks.data ? summarizeChecks(checks.data.rows) : null;

  return (
    <>
      {backLink}
      <PageHeader
        title={site.name}
        description={site.url}
        actions={
          <MonitorActions
            monitor={site}
            showRunCheck
            onChanged={reloadAll}
            onDeleted={() => navigate('/monitors')}
          />
        }
      />
      <StaleDataNotice error={monitor.error} onRetry={reloadAll} />

      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1">
        <StatusBadge monitor={site} />
        <span className="text-sm text-ink-secondary">Last checked {formatRelativeTime(site.lastCheckedAt).toLowerCase()}</span>
        {site.lastResponseTimeMs !== null ? <span className="text-sm text-ink-secondary">{formatMs(site.lastResponseTimeMs)}</span> : null}
        <FailureStreakNote monitor={site} />
      </div>

      <section aria-label="Uptime" className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Uptime, 24 hours" value={formatUptime(site.uptime['24h'])} detail={uptimeDetail(site.uptime['24h'])} />
        <StatTile label="Uptime, 7 days" value={formatUptime(site.uptime['7d'])} detail={uptimeDetail(site.uptime['7d'])} />
        <StatTile label="Uptime, 30 days" value={formatUptime(site.uptime['30d'])} detail={uptimeDetail(site.uptime['30d'])} />
      </section>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <RangePicker value={rangeKey} onChange={setRangeKey} />
        {rangeSummary?.total > 0 ? (
          <p className="text-sm text-ink-secondary">
            {rangeSummary.averageMs === null ? 'No response times' : `Average ${formatMs(rangeSummary.averageMs)}`} ·{' '}
            {rangeSummary.failed} failed of {rangeSummary.total.toLocaleString()}
          </p>
        ) : null}
      </div>

      <section aria-labelledby="chart-heading" className="mb-8">
        <Card className="p-4">
          <h2 id="chart-heading" className="mb-3 font-semibold">Response time</h2>
          {checks.loading ? <LoadingState label="Loading checks" /> : null}
          {!checks.loading && !checks.data ? <ErrorState error={checks.error} onRetry={checks.reload} /> : null}
          {checks.data ? (
            <LazyResponseTimeChart checks={checks.data.rows} from={checks.data.from} to={checks.data.to} dimmed={checks.refreshing} />
          ) : null}
        </Card>
      </section>

      <section aria-labelledby="history-heading" className="mb-8">
        <h2 id="history-heading" className="mb-3 font-semibold">Check history</h2>
        <Card>
          {checks.loading ? <LoadingState label="Loading checks" /> : null}
          {checks.data && checks.data.rows.length === 0 ? (
            <EmptyState icon={History} title="No checks in this range" />
          ) : null}
          {checks.data && checks.data.rows.length > 0 ? <CheckHistoryTable checks={checks.data.rows} /> : null}
          {!checks.loading && !checks.data ? <ErrorState error={checks.error} onRetry={checks.reload} /> : null}
        </Card>
      </section>

      <section aria-labelledby="monitor-incidents-heading">
        <h2 id="monitor-incidents-heading" className="mb-3 font-semibold">Incidents</h2>
        <Card>
          {incidents.loading ? <LoadingState label="Loading incidents" /> : null}
          {!incidents.loading && !incidents.data ? <ErrorState error={incidents.error} onRetry={incidents.reload} /> : null}
          {incidents.data ? <IncidentList incidents={incidents.data} /> : null}
        </Card>
      </section>
    </>
  );
}
