import { Pause, Pencil, Play, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { describeFailure } from '../lib/format.js';
import { buttonClass, Button } from './ui.jsx';
import { ConfirmDialog } from './ConfirmDialog.jsx';

export function MonitorActions({ monitor, onChanged, onDeleted, showRunCheck = false }) {
  const toast = useToast();
  const [busyAction, setBusyAction] = useState(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function perform(action, work) {
    setBusyAction(action);
    try {
      await work();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusyAction(null);
    }
  }

  const togglePaused = () =>
    perform('pause', async () => {
      await api.updateMonitor(monitor.id, { paused: !monitor.paused });
      toast.success(monitor.paused ? `Resumed ${monitor.name}.` : `Paused ${monitor.name}.`);
      await onChanged?.();
    });

  const runCheck = () =>
    perform('check', async () => {
      const { check } = await api.runCheck(monitor.id);
      if (check.success) toast.success(`Check passed in ${check.responseTimeMs} ms.`);
      else toast.error(`Check failed: ${describeFailure(check)}.`);
      await onChanged?.();
    });

  const remove = () =>
    perform('delete', async () => {
      await api.deleteMonitor(monitor.id);
      toast.success(`Deleted ${monitor.name}.`);
      setConfirmingDelete(false);
      await onDeleted?.();
    });

  return (
    <>
      {showRunCheck ? (
        <Button onClick={runCheck} busy={busyAction === 'check'} disabled={monitor.paused}>
          {busyAction === 'check' ? null : <RefreshCw aria-hidden="true" className="size-4" />}
          Run check
        </Button>
      ) : null}
      <Button onClick={togglePaused} busy={busyAction === 'pause'} aria-label={`${monitor.paused ? 'Resume' : 'Pause'} ${monitor.name}`}>
        {busyAction === 'pause' ? null : monitor.paused ? (
          <Play aria-hidden="true" className="size-4" />
        ) : (
          <Pause aria-hidden="true" className="size-4" />
        )}
        {monitor.paused ? 'Resume' : 'Pause'}
      </Button>
      <Link to={`/monitors/${monitor.id}/edit`} className={buttonClass()} aria-label={`Edit ${monitor.name}`}>
        <Pencil aria-hidden="true" className="size-4" />
        Edit
      </Link>
      <Button onClick={() => setConfirmingDelete(true)} aria-label={`Delete ${monitor.name}`}>
        <Trash2 aria-hidden="true" className="size-4" />
        Delete
      </Button>

      {confirmingDelete ? (
        <ConfirmDialog
          title={`Delete ${monitor.name}?`}
          description="This permanently removes the monitor, its check history and its incidents."
          confirmLabel="Delete monitor"
          busy={busyAction === 'delete'}
          onConfirm={remove}
          onCancel={() => setConfirmingDelete(false)}
        />
      ) : null}
    </>
  );
}
