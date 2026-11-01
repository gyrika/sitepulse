import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { Link } from 'react-router';

const BUTTON_BASE =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';

const BUTTON_VARIANTS = {
  primary: 'bg-accent-strong text-white hover:bg-accent',
  secondary: 'border border-line bg-surface text-ink hover:bg-hover',
  danger: 'bg-critical-strong text-white hover:bg-critical',
  ghost: 'text-ink-secondary hover:bg-hover hover:text-ink',
};

export function buttonClass(variant = 'secondary') {
  return `${BUTTON_BASE} ${BUTTON_VARIANTS[variant]}`;
}

export function Button({ variant = 'secondary', busy = false, children, className = '', ...props }) {
  return (
    <button type="button" className={`${buttonClass(variant)} ${className}`} disabled={busy || props.disabled} {...props}>
      {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

export function Card({ children, className = '' }) {
  return <section className={`rounded-xl border border-line bg-surface ${className}`}>{children}</section>;
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm break-words text-ink-secondary">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function LoadingState({ label = 'Loading' }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-ink-secondary">
      <Loader2 aria-hidden="true" className="size-4 animate-spin" />
      {label}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center px-4 py-14 text-center">
      {Icon ? <Icon aria-hidden="true" className="mb-3 size-8 text-ink-muted" /> : null}
      <h2 className="font-medium">{title}</h2>
      {description ? <p className="mt-1 max-w-md text-sm text-ink-secondary">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'This could not be loaded' }) {
  return (
    <div role="alert" className="flex flex-col items-center px-4 py-14 text-center">
      <AlertCircle aria-hidden="true" className="mb-3 size-8 text-critical" />
      <h2 className="font-medium">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-ink-secondary">{error?.message}</p>
      {onRetry ? (
        <Button className="mt-4" onClick={onRetry}>
          <RefreshCw aria-hidden="true" className="size-4" />
          Try again
        </Button>
      ) : null}
    </div>
  );
}

// Shown above existing data when a background refresh fails.
export function StaleDataNotice({ error, onRetry }) {
  if (!error) return null;
  return (
    <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-critical-wash px-3 py-2 text-sm">
      <span>Could not refresh, so this may be out of date. {error.message}</span>
      <button type="button" onClick={onRetry} className="font-medium underline underline-offset-2">
        Try again
      </button>
    </div>
  );
}

export function TextLink({ to, children }) {
  return (
    <Link
      to={to}
      className="inline-flex min-h-10 items-center text-sm font-medium text-accent-strong underline-offset-2 hover:underline dark:text-accent"
    >
      {children}
    </Link>
  );
}
