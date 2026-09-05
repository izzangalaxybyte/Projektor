import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { imageUrl } from '../api/client.js';
import { IptvTile } from '../components/IptvTile.js';
import { LiveTabs } from '../components/LiveTabs.js';
import { useIptvCategories, useIptvMovie, useIptvMovies } from '../hooks/useLive.js';

export function IptvMoviesPage() {
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const categories = useIptvCategories('vod');
  const query = useIptvMovies(category, search);
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const total = query.data?.pages[0]?.total ?? 0;
  return (
    <section className="page">
      <header className="page-head">
        <h1>Live TV</h1>
        <div className="page-tools">
          <span className="muted" data-testid="movie-count">
            {total} movies
          </span>
        </div>
      </header>
      <LiveTabs active="movies" />
      <div className="catalog-tools">
        <input
          className="text-input"
          type="search"
          placeholder="Search IPTV movies"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search IPTV movies"
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
      {query.isError && <p className="form-error">Could not load IPTV movies.</p>}
      {query.isSuccess && items.length === 0 && (
        <p className="muted">No movies from the provider yet.</p>
      )}
      <div className="grid">
        {items.map((m) => (
          <IptvTile
            key={m.id}
            to={`/live/movies/${m.id}`}
            title={m.title}
            year={m.year}
            posterKey={m.posterKey}
            fallbackUrl={m.logoUrl}
            needsReview={m.needsReview}
            testId="tile-iptv-movie"
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

export function IptvMoviePage() {
  const { vodId } = useParams();
  const movie = useIptvMovie(vodId);
  if (movie.isPending) return <p className="muted">Loading…</p>;
  if (movie.isError || !movie.data)
    return <p className="form-error">This movie could not be loaded.</p>;
  const d = movie.data;
  const poster = imageUrl(d.posterKey, 300) ?? d.logoUrl;
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
            <Link to="/live/movies" className="muted">
              IPTV Movies
            </Link>
          </p>
          <h1 data-testid="iptv-title">{d.title}</h1>
          <p className="muted">
            {[
              d.year,
              d.runtimeMs ? `${Math.round(d.runtimeMs / 60000)} min` : null,
              d.rating ? `★ ${d.rating.toFixed(1)}` : null,
              d.containerExtension.toUpperCase(),
              ...d.genres,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {d.overview && <p className="overview">{d.overview}</p>}
          {d.needsReview && (
            <p className="review-note">Not matched on TMDB; this is the provider's own title.</p>
          )}
          <div className="actions">
            <Link to={`/live/movies/${d.id}/watch`} className="button primary" data-testid="play">
              Play
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}
