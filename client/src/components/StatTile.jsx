import { Card } from './ui.jsx';

export function StatTile({ label, value, detail }) {
  return (
    <Card className="p-4">
      <p className="text-sm text-ink-secondary">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight break-words">{value}</p>
      {detail ? <p className="mt-1 text-xs text-ink-secondary">{detail}</p> : null}
    </Card>
  );
}
