import { useState } from 'react';
import { Grid } from '../components/Grid.js';
import { useSearch } from '../hooks/useItems.js';

export function SearchPage() {
  const [q, setQ] = useState('');
  const results = useSearch(q);
  return (
    <section className="page">
      <h1>Search</h1>
      <input
        className="text-input"
        placeholder="Title…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
        aria-label="Search titles"
      />
      {results.data && results.data.length === 0 && <p className="muted">No matches.</p>}
      {results.data && <Grid items={results.data} />}
    </section>
  );
}
