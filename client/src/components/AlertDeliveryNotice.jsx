import { AlertTriangle, RefreshCw, XCircle } from 'lucide-react';
import { Link } from 'react-router';
import { formatDateTime } from '../lib/format.js';
import { Card } from './ui.jsx';

const emails = (count) => `${count} alert ${count === 1 ? 'email' : 'emails'}`;

function describeProblems({ failed, retrying }) {
  const parts = [];
  if (failed > 0) parts.push(`${emails(failed)} could not be sent`);
  if (retrying > 0) parts.push(`${emails(retrying)} waiting to retry`);
  return `${parts.join(', ')}.`;
}

function describeAttempts(alert) {
  const tries = `${alert.attempts} ${alert.attempts === 1 ? 'attempt' : 'attempts'}`;
  return alert.status === 'FAILED'
    ? `Gave up after ${tries}`
    : `Failed ${tries}. Next try ${formatDateTime(alert.nextAttemptAt)}`;
}

// Monitoring still works when email does not, so this sits apart from the site status.
export function AlertDeliveryNotice({ delivery }) {
  const { failed, retrying, recent } = delivery;
  const total = failed + retrying;
  if (total === 0) return null;

  return (
    <Card className="mb-6">
      <section aria-labelledby="alert-delivery-heading">
        <div className="flex items-start gap-2.5 border-b border-line px-4 py-3">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-warning" />
          <div className="min-w-0">
            <h2 id="alert-delivery-heading" className="font-medium">{describeProblems(delivery)}</h2>
            <p className="text-sm text-ink-secondary">
              You may have missed these outage emails. To test your email settings, run{' '}
              <code className="break-words">npm run alert:test</code> on the server.
            </p>
          </div>
        </div>
        <ul className="divide-y divide-line">
          {recent.map((alert) => {
            const gaveUp = alert.status === 'FAILED';
            const Icon = gaveUp ? XCircle : RefreshCw;
            return (
              <li key={alert.id} className="flex items-start gap-3 px-4 py-3">
                <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${gaveUp ? 'text-critical' : 'text-neutral'}`} />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="break-words">
                    <span className="font-medium">{alert.type === 'DOWN' ? 'Down' : 'Recovered'} alert</span>
                    {alert.monitor ? (
                      <>
                        {' for '}
                        <Link to={`/monitors/${alert.monitor.id}`} className="font-medium hover:underline">
                          {alert.monitor.name}
                        </Link>
                      </>
                    ) : null}
                  </p>
                  <p className="text-ink-secondary">{describeAttempts(alert)}</p>
                  <p className="text-xs break-words text-ink-secondary">{alert.lastError}</p>
                </div>
              </li>
            );
          })}
        </ul>
        {total > recent.length ? (
          <p className="border-t border-line px-4 py-3 text-xs text-ink-secondary">
            Showing the latest {recent.length} of {total}.
          </p>
        ) : null}
      </section>
    </Card>
  );
}
