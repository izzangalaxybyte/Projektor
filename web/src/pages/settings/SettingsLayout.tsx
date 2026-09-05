import { Navigate, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../auth/useAuth.js';

const TABS = [
  { to: '/settings', label: 'Libraries', end: true },
  { to: '/settings/metadata', label: 'Metadata' },
  { to: '/settings/users', label: 'Users' },
  { to: '/settings/review', label: 'Needs review' },
];

export function SettingsLayout() {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/" replace />;
  return (
    <section className="page settings">
      <h1>Settings</h1>
      <nav className="tabs" aria-label="Settings sections">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end ?? false}
            className={({ isActive }) => (isActive ? 'tab active' : 'tab')}
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </section>
  );
}
