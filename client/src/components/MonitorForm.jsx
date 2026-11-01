import { AlertCircle } from 'lucide-react';
import { useState } from 'react';
import { Button } from './ui.jsx';

// Which form field each server error belongs to.
const URL_ERROR_CODES = new Set(['BLOCKED_TARGET', 'INVALID_URL', 'DNS_ERROR', 'DUPLICATE_MONITOR']);

const URL_ERROR_MESSAGES = {
  BLOCKED_TARGET: 'This address is private or reserved. SitePulse only monitors public websites.',
  DNS_ERROR: 'This host name could not be found. Check the spelling.',
};

function toFieldErrors(error) {
  if (URL_ERROR_CODES.has(error.code)) {
    return { url: URL_ERROR_MESSAGES[error.code] ?? error.message };
  }
  const fields = {};
  for (const { field, message } of error.details ?? []) {
    if (field === 'body.name') fields.name = message;
    if (field === 'body.url') fields.url = message;
  }
  return Object.keys(fields).length > 0 ? fields : { form: error.message };
}

function Field({ id, label, hint, error, ...inputProps }) {
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">{label}</label>
      <input
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        className={`mt-1.5 block min-h-10 w-full rounded-lg border bg-page px-3 text-sm placeholder:text-ink-muted ${
          error ? 'border-critical' : 'border-line'
        }`}
        {...inputProps}
      />
      {hint ? <p id={`${id}-hint`} className="mt-1.5 text-xs text-ink-secondary">{hint}</p> : null}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 flex items-start gap-1.5 text-sm">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-critical" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function MonitorForm({ initial, submitLabel, urlHint, showStartPaused = false, onSubmit, onCancel }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [paused, setPaused] = useState(false);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();

    const missing = {};
    if (!name.trim()) missing.name = 'Enter a name for this monitor.';
    if (!url.trim()) missing.url = 'Enter the address to monitor.';
    if (Object.keys(missing).length > 0) {
      setErrors(missing);
      return;
    }

    setErrors({});
    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), url: url.trim(), ...(paused ? { paused } : {}) });
    } catch (error) {
      setErrors(toFieldErrors(error));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5 p-5">
      {errors.form ? (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-critical-wash px-3 py-2 text-sm">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-critical" />
          {errors.form}
        </p>
      ) : null}

      <Field
        id="monitor-name"
        label="Name"
        placeholder="Company website"
        maxLength={100}
        autoComplete="off"
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={errors.name}
      />
      <Field
        id="monitor-url"
        label="URL"
        type="url"
        inputMode="url"
        placeholder="https://example.com"
        maxLength={2048}
        autoComplete="off"
        spellCheck={false}
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        error={errors.url}
        hint={urlHint}
      />

      {showStartPaused ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={paused}
            onChange={(event) => setPaused(event.target.checked)}
            className="size-4 accent-[var(--accent)]"
          />
          Start paused
        </label>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="submit" variant="primary" busy={submitting}>{submitLabel}</Button>
        <Button onClick={onCancel} disabled={submitting}>Cancel</Button>
      </div>
    </form>
  );
}
