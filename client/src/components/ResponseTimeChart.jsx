import { Activity } from 'lucide-react';
import { useMemo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { buildChartRows, findFailureRuns, niceTicks } from '../lib/chartData.js';
import { describeFailure, formatAxisTime, formatTimeWithSeconds } from '../lib/format.js';
import { EmptyState } from './ui.jsx';

function ChartTooltip({ active, payload }) {
  const row = payload?.[0]?.payload;
  if (!active || !row?.check) return null;

  const { check } = row;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-lg">
      <p className="font-semibold">{check.success ? `${check.responseTimeMs} ms` : describeFailure(check)}</p>
      <p className="text-xs text-ink-secondary">{check.success ? 'Response time' : 'Failed check'}</p>
      <p className="mt-1 text-xs text-ink-secondary">{formatTimeWithSeconds(check.checkedAt)}</p>
    </div>
  );
}

// A line cannot show a single point, so a success with no neighbours draws a dot.
function IsolatedPointDot({ cx, cy, payload, index }) {
  if (!payload?.isolated) return <g key={index} />;
  return <circle key={index} cx={cx} cy={cy} r={4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />;
}

function FailureRunDot({ cx, cy, payload, index }) {
  if (!payload?.failedDot) return <g key={index} />;
  return <circle key={index} cx={cx} cy={cy} r={4} fill="var(--critical)" stroke="var(--surface)" strokeWidth={2} />;
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-4 text-xs text-ink-secondary">
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="h-0.5 w-4 rounded" style={{ background: 'var(--series-1)' }} />
        Response time
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="size-2 rounded-full" style={{ background: 'var(--critical)' }} />
        Failed check
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="h-3 w-4 rounded-sm" style={{ background: 'var(--critical-wash)', borderBottom: '2px solid var(--critical)' }} />
        Consecutive failures
      </li>
    </ul>
  );
}

/**
 * The x-axis always spans the full selected range, including time with no checks, so
 * a monitor that has run for ten minutes looks like ten minutes and not a full day.
 */
export function ResponseTimeChart({ checks, from, to, dimmed = false }) {
  const rows = useMemo(() => buildChartRows(checks), [checks]);
  const failureRuns = useMemo(() => findFailureRuns(rows), [rows]);
  const yTicks = useMemo(() => niceTicks(Math.max(0, ...rows.map((row) => row.responseTimeMs ?? 0))), [rows]);

  if (checks.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="No checks in this range"
        description="Results will appear here after the next check runs."
      />
    );
  }

  return (
    <div className={`transition-opacity ${dimmed ? 'opacity-60' : ''}`}>
      <div role="img" aria-label={`Response time chart with ${checks.length} checks. The check history table has the same data.`}>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" strokeWidth={1} />
            <XAxis
              dataKey="time"
              type="number"
              scale="time"
              domain={[from, to]}
              tickFormatter={formatAxisTime}
              minTickGap={48}
              tick={{ fill: 'var(--ink-muted)', fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: 'var(--axis)' }}
            />
            <YAxis
              domain={[0, yTicks.at(-1)]}
              ticks={yTicks}
              tickFormatter={(value) => `${value.toLocaleString()} ms`}
              width={64}
              tick={{ fill: 'var(--ink-muted)', fontSize: 12 }}
              tickLine={false}
              axisLine={false}
            />
            {failureRuns.map((run) => (
              <ReferenceArea key={run.from} x1={run.from} x2={run.to} fill="var(--critical)" fillOpacity={0.1} stroke="none" ifOverflow="hidden" />
            ))}
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }} isAnimationActive={false} />
            <Line
              dataKey="responseTimeMs"
              name="Response time"
              stroke="var(--series-1)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              connectNulls={false}
              dot={IsolatedPointDot}
              activeDot={{ r: 4, fill: 'var(--series-1)', stroke: 'var(--surface)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
            <Line
              dataKey="failedMarker"
              name="Failed check"
              stroke="var(--critical)"
              strokeWidth={3}
              strokeLinecap="round"
              connectNulls={false}
              dot={FailureRunDot}
              activeDot={{ r: 5, fill: 'var(--critical)', stroke: 'var(--surface)', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3">
        <Legend />
      </div>
    </div>
  );
}
