import { CheckCircle2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { describeFailure, formatMs, formatTimeWithSeconds } from '../lib/format.js';
import { Button } from './ui.jsx';

const PAGE_SIZE = 20;

// The table view of the chart: every value is readable here without hovering.
export function CheckHistoryTable({ checks }) {
  const [visible, setVisible] = useState(PAGE_SIZE);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-ink-secondary">
            <tr className="border-b border-line">
              <th scope="col" className="px-4 py-2.5 font-medium">Time</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Result</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Response time</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line tabular-nums">
            {checks.slice(0, visible).map((check) => (
              <tr key={check.id}>
                <td className="px-4 py-2.5 whitespace-nowrap">{formatTimeWithSeconds(check.checkedAt)}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    {check.success ? (
                      <CheckCircle2 aria-hidden="true" className="size-4 text-good" />
                    ) : (
                      <XCircle aria-hidden="true" className="size-4 text-critical" />
                    )}
                    {check.success ? `OK, HTTP ${check.httpStatus}` : describeFailure(check)}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">{formatMs(check.responseTimeMs)}</td>
                <td className="px-4 py-2.5 whitespace-nowrap text-ink-secondary">
                  {check.source === 'MANUAL' ? 'Manual' : 'Scheduled'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {checks.length > visible ? (
        <div className="border-t border-line p-3 text-center">
          <Button variant="ghost" onClick={() => setVisible(visible + PAGE_SIZE)}>
            Show more ({checks.length - visible} remaining)
          </Button>
        </div>
      ) : null}
    </>
  );
}
