import { NavLink } from 'react-router-dom';

/** Channels, IPTV Movies, IPTV Series: the three sections of Live TV. */
export function LiveTabs({ active }: { active: 'channels' | 'movies' | 'series' }) {
  const tabs = [
    { key: 'channels', to: '/live', label: 'Channels' },
    { key: 'movies', to: '/live/movies', label: 'IPTV Movies' },
    { key: 'series', to: '/live/series', label: 'IPTV Series' },
  ] as const;
  return (
    <nav className="tabs" aria-label="Live TV sections">
      {tabs.map((t) => (
        <NavLink
          key={t.key}
          to={t.to}
          end
          className={t.key === active ? 'tab active' : 'tab'}
          data-testid={`live-tab-${t.key}`}
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
