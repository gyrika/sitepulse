import { useEffect, useRef } from 'react';
import { Button } from './ui.jsx';

// The native <dialog> provides focus trapping, Escape to close and a backdrop.
export function ConfirmDialog({ title, description, confirmLabel, busy, onConfirm, onCancel }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      aria-labelledby="confirm-title"
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-line bg-surface p-5 text-ink backdrop:bg-black/50"
    >
      <h2 id="confirm-title" className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm break-words text-ink-secondary">{description}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="danger" busy={busy} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </dialog>
  );
}
