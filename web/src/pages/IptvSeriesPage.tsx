import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { imageUrl } from '../api/client.js';
import { IptvTile } from '../components/IptvTile.js';
import { LiveTabs } from '../components/LiveTabs.js';
import { useIptvCategories, useIptvSeries, useIptvSeriesList } from '../hooks/useLive.js';
import { fmt } from './ItemPage.js';

export function IptvSeriesPage() {
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const categories = useIptvCategories('series');
  const query = useIptvSeriesList(category, search);
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const total = query.data?.pages[0]?.total ?? 0;
  return (
    <section className="page">
      <header className="page-head">
        <h1>Live TV</h1>
        <div className="page-tools">
          <span className="muted" data-testid="series-count">
            {total} series
          </span>
        </div>
      </header>
      <LiveTabs active="series" />
      <div className="catalog-tools">
        <input
          className="text-input"
          type="search"
          placeholder="Search IPTV series"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search IPTV series"
        />
        <select
          value={category ?? ''}
          onChange={(e) => setCategory(e.target.value || null)}
          aria-label="Category"
        >
          <option value="">All categories</option>
          {(categories.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {query.isPending && <p className="muted">Loading…</p>}
      {query.isError && <p className="form-error">Could not load IPTV series.</p>}
      {query.isSuccess && items.length === 0 && (
        <p className="muted">No series from the provider yet.</p>
      )}
      <div className="grid">
        {items.map((s) => (
          <IptvTile
            key={s.id}
            to={`/live/series/${s.id}`}
            title={s.title}
            year={s.year}
            posterKey={s.posterKey}
            fallbackUrl={s.coverUrl}
            needsReview={s.needsReview}
            testId="tile-iptv-series"
          />
        ))}
      </div>
      {query.hasNextPage && (
        <button
          type="button"
          className="button"
          onClick={() => query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
        >
          Load more
        </button>
      )}
    </section>
  );
}

export function IptvSeriesDetailPage() {
  const { seriesId } = useParams();
  const series = useIptvSeries(seriesId);
  const [season, setSeason] = useState<number | null>(null);
  if (series.isPending) return <p className="muted">Loading…</p>;
  if (series.isError || !series.data)
    return <p className="form-error">This series could not be loaded.</p>;
  const d = series.data;
  const poster = imageUrl(d.posterKey, 300) ?? d.coverUrl;
  const current = d.seasons.find((s) => s.number === season) ?? d.seasons[0];
  return (
    <article className="detail">
      {d.backdropKey && (
        <div
          className="detail-backdrop"
          style={{ backgroundImage: `url(${imageUrl(d.backdropKey, 1280)})` }}
        />
      )}
      <div className="detail-body">
        <div className="detail-poster">
          {poster ? (
            <img src={poster} alt="" />
          ) : (
            <div className="tile-placeholder big">{d.title.slice(0, 1)}</div>
          )}
        </div>
        <div className="detail-text">
          <p className="muted crumb">
            <Link to="/live/series" className="muted">
              IPTV Series
            </Link>
          </p>
          <h1 data-testid="iptv-title">{d.title}</h1>
          <p className="muted">
            {[d.year, d.rating ? `★ ${d.rating.toFixed(1)}` : null, ...d.genres]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {d.overview && <p className="overview">{d.overview}</p>}
          {d.needsReview && (
            <p className="review-note">Not matched on TMDB; this is the provider's own title.</p>
          )}
        </div>
      </div>
      {d.seasons.length === 0 ? (
        <p className="muted">The provider lists no episodes for this series.</p>
      ) : (
        <section className="page">
          <div className="chips" role="tablist" aria-label="Seasons">
            {d.seasons.map((s) => (
              <button
                key={s.number}
                type="button"
                role="tab"
                aria-selected={current?.number === s.number}
                className={`chip ${current?.number === s.number ? 'active' : ''}`}
                onClick={() => setSeason(s.number)}
                data-testid={`season-${s.number}`}
              >
                Season {s.number}
              </button>
            ))}
          </div>
          <ul className="plain episode-list">
            {(current?.episodes ?? []).map((e) => (
              <li key={e.id} data-testid={`episode-${e.id}`}>
                <span className="muted">E{e.episodeNumber}</span>
                <span>
                  <span className="guide-title">{e.title}</span>
                  {e.overview && <span className="muted small guide-desc">{e.overview}</span>}
                  {e.durationMs && (
                    <span className="muted small guide-desc">{fmt(e.durationMs)}</span>
                  )}
                </span>
                <Link to={`/live/series/${d.id}/episodes/${e.id}/watch`} className="button small">
                  Play
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
