import { CHART_RANGES } from '../lib/chartData.js';

export function RangePicker({ value, onChange }) {
  return (
    <div role="group" aria-label="Time range" className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {CHART_RANGES.map((range) => (
        <button
          key={range.key}
          type="button"
          aria-pressed={value === range.key}
          onClick={() => onChange(range.key)}
          className={`min-h-9 rounded-md px-3 text-sm whitespace-nowrap transition-colors ${
            value === range.key ? 'bg-hover font-medium text-ink' : 'text-ink-secondary hover:text-ink'
          }`}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}
