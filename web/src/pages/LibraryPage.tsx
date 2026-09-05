import { useState } from 'react';
import { Grid } from '../components/Grid.js';
import { KIND_LABEL, useLibraryItems, type LibraryKind, type Sort } from '../hooks/useItems.js';

export function LibraryPage({ kind }: { kind: LibraryKind }) {
  const [sort, setSort] = useState<Sort>('title');
  const query = useLibraryItems(kind, sort);
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const total = query.data?.pages[0]?.total ?? 0;
  return (
    <section className="page">
      <header className="page-head">
        <h1>{KIND_LABEL[kind]}</h1>
        <div className="page-tools">
          <span className="muted">{total} titles</span>
          <label>
            Sort{' '}
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              <option value="title">Title</option>
              <option value="year">Year</option>
              <option value="added">Recently added</option>
            </select>
          </label>
        </div>
      </header>
      {query.isPending && <p className="muted">Loading…</p>}
      {query.isError && <p className="form-error">Could not load this library.</p>}
      {items.length === 0 && query.isSuccess && (
        <p className="muted">No {KIND_LABEL[kind].toLowerCase()} yet.</p>
      )}
      <Grid items={items} />
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
