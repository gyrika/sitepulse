import { Activity, LayoutDashboard, List, LogOut, Menu, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';

const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/monitors', label: 'Monitors', icon: List, end: true },
  { to: '/monitors/new', label: 'Add monitor', icon: Plus, end: true },
];

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2 rounded font-semibold tracking-tight">
      <span className="flex size-7 items-center justify-center rounded-lg bg-accent-strong text-white">
        <Activity aria-hidden="true" className="size-4" />
      </span>
      SitePulse
    </Link>
  );
}

function Navigation({ onSignOut }) {
  return (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-1">
      {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors ${
              isActive ? 'bg-hover font-medium text-ink' : 'text-ink-secondary hover:bg-hover hover:text-ink'
            }`
          }
        >
          <Icon aria-hidden="true" className="size-4" />
          {label}
        </NavLink>
      ))}
      <button
        type="button"
        onClick={onSignOut}
        className="mt-auto flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-sm text-ink-secondary transition-colors hover:bg-hover hover:text-ink"
      >
        <LogOut aria-hidden="true" className="size-4" />
        Sign out
      </button>
    </nav>
  );
}

export function Layout() {
  const { logout } = useAuth();
  const toast = useToast();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  const signOut = () => logout().catch((error) => toast.error(error.message));

  return (
    <div className="min-h-screen lg:pl-60">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-surface focus:p-2"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col gap-6 border-r border-line bg-surface p-4 lg:flex">
        <Brand />
        <Navigation onSignOut={signOut} />
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface px-4 py-2.5 lg:hidden">
        <Brand />
        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-expanded={menuOpen}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          className="flex size-10 items-center justify-center rounded-lg hover:bg-hover"
        >
          {menuOpen ? <X aria-hidden="true" className="size-5" /> : <Menu aria-hidden="true" className="size-5" />}
        </button>
      </header>
      {menuOpen ? (
        <div className="sticky top-[57px] z-20 flex flex-col border-b border-line bg-surface p-3 shadow-lg lg:hidden">
          <Navigation onSignOut={signOut} />
        </div>
      ) : null}

      <main id="main" className="mx-auto max-w-6xl px-4 py-6 lg:px-8 lg:py-8">
        <Outlet />
      </main>
    </div>
  );
}
