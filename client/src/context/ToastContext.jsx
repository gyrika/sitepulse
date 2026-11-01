import { CheckCircle2, X, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const TOAST_DURATION_MS = 6000;

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (kind, message) => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((current) => [...current, { id, kind, message }]);
      setTimeout(() => dismiss(id), TOAST_DURATION_MS);
    },
    [dismiss],
  );

  const value = useMemo(
    () => ({
      success: (message) => show('success', message),
      error: (message) => show('error', message),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* aria-live makes screen readers announce each message as it appears. */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-line bg-surface p-3 text-sm shadow-lg"
          >
            {toast.kind === 'success' ? (
              <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-good" />
            ) : (
              <XCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-critical" />
            )}
            <p className="min-w-0 flex-1 break-words">{toast.message}</p>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss message"
              className="rounded text-ink-muted hover:text-ink"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
