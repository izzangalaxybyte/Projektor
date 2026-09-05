import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, unwrap, type ItemSummary, type MatchCandidate } from '../../api/client.js';

/** Items matched from their file names only, with a search-and-pick correction flow. */
export function ReviewSettings() {
  const review = useQuery({
    queryKey: ['review'],
    queryFn: async () =>
      unwrap(
        await api.GET('/api/items', { params: { query: { needsReview: 'true', limit: 200 } } }),
      ).items,
  });
  const anime = useQuery({
    queryKey: ['anime-shows'],
    queryFn: async () =>
      unwrap(
        await api.GET('/api/items', {
          params: { query: { libraryKind: 'anime', kind: 'show', limit: 200 } },
        }),
      ).items,
  });
  return (
    <div className="settings-body">
      <p className="muted">
        Titles below were identified from their file names only. Search for the right match and pick
        it; the file stays where it is.
      </p>
      {review.data?.length === 0 && (
        <p className="muted" data-testid="review-empty">
          Everything is matched.
        </p>
      )}
      <ul className="card-list" data-testid="review-list">
        {(review.data ?? []).map((item) => (
          <ReviewCard key={item.id} item={item} />
        ))}
      </ul>
      {(anime.data?.length ?? 0) > 0 && (
        <>
          <h2>Anime season mapping</h2>
          <p className="muted small">
            When fansub numbering starts over for a sequel, add the earlier seasons' episode count
            here so episodes land on the right TMDB season.
          </p>
          <ul className="card-list">
            {anime.data!.map((show) => (
              <OffsetCard key={show.id} show={show} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ReviewCard({ item }: { item: ItemSummary }) {
  const qc = useQueryClient();
  const [query, setQuery] = useState(item.title);
  const [year, setYear] = useState(item.year ? String(item.year) : '');
  const [open, setOpen] = useState(false);
  const candidates = useQuery({
    queryKey: ['candidates', item.id, query, year],
    enabled: open,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/items/{id}/candidates', {
          params: {
            path: { id: item.id },
            query: { query, ...(year ? { year: Number(year) } : {}) },
          },
        }),
      ),
  });
  const apply = useMutation({
    mutationFn: async (c: MatchCandidate) =>
      unwrap(
        await api.POST('/api/items/{id}/match', {
          params: { path: { id: item.id } },
          body: c.source === 'tmdb' ? { tmdbId: c.id } : { anilistId: c.id },
        }),
      ),
    onSuccess: () => void qc.invalidateQueries(),
  });
  return (
    <li className="card" data-testid={`review-${item.title}`}>
      <div className="card-head">
        <Link to={`/items/${item.id}`}>
          <strong>{item.title}</strong>
        </Link>
        <span className="pill">{item.kind}</span>
        <span className="muted small">{item.year ?? 'no year'}</span>
      </div>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          setOpen(true);
          void candidates.refetch();
        }}
      >
        <input
          className="text-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search title"
        />
        <input
          className="text-input year"
          value={year}
          onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="Year"
          aria-label="Year"
        />
        <button type="submit" className="button" data-testid="search-candidates">
          Search
        </button>
      </form>
      {candidates.isError && <p className="form-error">{(candidates.error as Error).message}</p>}
      {candidates.data && candidates.data.length === 0 && (
        <p className="muted small">No results.</p>
      )}
      {candidates.data && candidates.data.length > 0 && (
        <ul className="candidates">
          {candidates.data.map((c) => (
            <li key={`${c.source}-${c.id}`}>
              {c.posterUrl ? (
                <img src={c.posterUrl} alt="" />
              ) : (
                <span className="tile-placeholder small" />
              )}
              <div>
                <strong>{c.title}</strong> <span className="muted">{c.year ?? ''}</span>{' '}
                <span className="pill">{c.source}</span>
                <p className="muted small">{c.overview?.slice(0, 160)}</p>
              </div>
              <button
                type="button"
                className="button primary"
                onClick={() => apply.mutate(c)}
                disabled={apply.isPending}
              >
                Use this
              </button>
            </li>
          ))}
        </ul>
      )}
      {apply.error && <p className="form-error">{apply.error.message}</p>}
    </li>
  );
}

function OffsetCard({ show }: { show: ItemSummary }) {
  const qc = useQueryClient();
  const [offset, setOffset] = useState('');
  const apply = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/api/items/{id}/match', {
          params: { path: { id: show.id } },
          body: { seasonOffset: Number(offset) },
        }),
      ),
    onSuccess: () => void qc.invalidateQueries(),
  });
  return (
    <li className="card row-card" data-testid={`offset-${show.title}`}>
      <strong>{show.title}</strong>
      <input
        className="text-input year"
        value={offset}
        onChange={(e) => setOffset(e.target.value.replace(/[^\d-]/g, ''))}
        placeholder="Offset"
        aria-label={`Season offset for ${show.title}`}
      />
      <button
        type="button"
        className="button"
        disabled={offset === '' || apply.isPending}
        onClick={() => apply.mutate()}
      >
        Apply
      </button>
      {apply.isSuccess && (
        <span className="muted small" data-testid="offset-saved">
          Saved
        </span>
      )}
      {apply.error && <span className="form-error">{apply.error.message}</span>}
    </li>
  );
}
