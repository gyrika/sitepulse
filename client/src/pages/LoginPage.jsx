import { Activity, AlertCircle } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Button } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export function LoginPage() {
  const { status, login } = useAuth();
  const location = useLocation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'signedIn') {
    return <Navigate to={location.state?.from ?? '/'} replace />;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!password) {
      setError('Enter your password.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await login(password);
    } catch (loginError) {
      setError(loginError.message);
      setPassword('');
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2 text-lg font-semibold tracking-tight">
          <span className="flex size-8 items-center justify-center rounded-lg bg-accent-strong text-white">
            <Activity aria-hidden="true" className="size-4" />
          </span>
          SitePulse
        </div>
        <form onSubmit={handleSubmit} noValidate className="space-y-4 rounded-xl border border-line bg-surface p-5">
          <h1 className="text-lg font-semibold">Admin sign in</h1>
          {error ? (
            <p role="alert" className="flex items-start gap-2 rounded-lg bg-critical-wash px-3 py-2 text-sm">
              <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-critical" />
              {error}
            </p>
          ) : null}
          <div>
            <label htmlFor="password" className="block text-sm font-medium">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1.5 block min-h-10 w-full rounded-lg border border-line bg-page px-3 text-sm"
            />
          </div>
          <Button type="submit" variant="primary" busy={submitting} className="w-full">Sign in</Button>
        </form>
      </div>
    </main>
  );
}
