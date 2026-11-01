import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { Layout } from './components/Layout.jsx';
import { EmptyState, ErrorState, LoadingState, TextLink } from './components/ui.jsx';
import { useAuth } from './context/AuthContext.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { MonitorDetailPage } from './pages/MonitorDetailPage.jsx';
import { EditMonitorPage, NewMonitorPage } from './pages/MonitorFormPages.jsx';
import { MonitorsPage } from './pages/MonitorsPage.jsx';
import { OverviewPage } from './pages/OverviewPage.jsx';

// This is convenience, not security: the server checks the session on every request.
function RequireSignIn() {
  const { status, error, retry } = useAuth();
  const location = useLocation();

  if (status === 'loading' || status === 'unreachable') {
    return (
      <main className="flex min-h-screen items-center justify-center">
        {status === 'loading' ? (
          <LoadingState label="Checking your session" />
        ) : (
          <ErrorState error={error} onRetry={retry} title="SitePulse is not reachable" />
        )}
      </main>
    );
  }
  if (status === 'signedOut') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

function NotFoundPage() {
  return <EmptyState title="Page not found" action={<TextLink to="/">Back to overview</TextLink>} />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireSignIn />}>
        <Route element={<Layout />}>
          <Route index element={<OverviewPage />} />
          <Route path="monitors" element={<MonitorsPage />} />
          <Route path="monitors/new" element={<NewMonitorPage />} />
          <Route path="monitors/:id" element={<MonitorDetailPage />} />
          <Route path="monitors/:id/edit" element={<EditMonitorPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
