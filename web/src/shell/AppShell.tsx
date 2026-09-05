import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/useAuth.js';

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/movies', label: 'Movies' },
  { to: '/tv', label: 'TV Shows' },
  { to: '/anime', label: 'Anime' },
  { to: '/search', label: 'Search' },
];

/** Top navigation plus the routed page. The TV shell in phase 3 swaps this for a D-pad layout. */
export function AppShell() {
  const { profile, isAdmin, signOut } = useAuth();
  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="brand small">
          Projektor
        </NavLink>
        <nav className="nav" aria-label="Primary">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end ?? false}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              {n.label}
            </NavLink>
          ))}
          {isAdmin && (
            <NavLink
              to="/settings"
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              Settings
            </NavLink>
          )}
        </nav>
        <div className="topbar-user">
          <span className="avatar tiny" style={{ background: profile?.avatarColor }}>
            {profile?.name.slice(0, 1).toUpperCase()}
          </span>
          <button type="button" className="link-button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
