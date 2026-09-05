import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, unwrap, type Library, type ScanStatus } from '../../api/client.js';

export function LibrariesSettings() {
  const qc = useQueryClient();
  const libraries = useQuery({
    queryKey: ['libraries'],
    queryFn: async () => unwrap(await api.GET('/api/libraries')),
  });
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'movie' | 'tv' | 'anime'>('movie');
  const [path, setPath] = useState('');
  const create = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/api/libraries', {
          body: { name: name.trim(), kind, paths: [path.trim()] },
        }),
      ),
    onSuccess: () => {
      setName('');
      setPath('');
      void qc.invalidateQueries({ queryKey: ['libraries'] });
    },
  });
  const remove = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.DELETE('/api/libraries/{id}', { params: { path: { id } } })),
    onSuccess: () => void qc.invalidateQueries(),
  });
  return (
    <div className="settings-body">
      <ul className="card-list" data-testid="library-list">
        {(libraries.data ?? []).map((l) => (
          <LibraryCard
            key={l.id}
            library={l}
            onDelete={() =>
              confirm(`Delete "${l.name}" and everything indexed from it?`) && remove.mutate(l.id)
            }
          />
        ))}
        {libraries.data?.length === 0 && <li className="muted">No libraries yet.</li>}
      </ul>
      <form
        className="card form"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
        data-testid="add-library"
      >
        <h2>Add a library</h2>
        <label>
          Name{' '}
          <input
            className="text-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label>
          Kind{' '}
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="movie">Movies</option>
            <option value="tv">TV Shows</option>
            <option value="anime">Anime</option>
          </select>
        </label>
        <label>
          Folder on the server{' '}
          <input
            className="text-input"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/media/movies"
            required
          />
        </label>
        <button type="submit" className="button primary" disabled={create.isPending}>
          Add library
        </button>
        {create.error && <p className="form-error">{create.error.message}</p>}
      </form>
    </div>
  );
}

function LibraryCard({ library, onDelete }: { library: Library; onDelete: () => void }) {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ['scan', library.id],
    queryFn: async () =>
      unwrap(await api.GET('/api/libraries/{id}/scan', { params: { path: { id: library.id } } })),
    refetchInterval: (q) => (q.state.data?.state === 'running' ? 1000 : false),
  });
  const scan = useMutation({
    mutationFn: async () =>
      unwrap(await api.POST('/api/libraries/{id}/scan', { params: { path: { id: library.id } } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['scan', library.id] }),
  });
  // When a scan finishes, everything it touched may have changed.
  const finished = status.data?.finishedAt;
  useEffect(() => {
    if (finished) void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'scan' });
  }, [finished, qc]);
  return (
    <li className="card" data-testid={`library-${library.name}`}>
      <div className="card-head">
        <strong>{library.name}</strong>
        <span className="pill">
          {{ movie: 'Movies', tv: 'TV Shows', anime: 'Anime' }[library.kind]}
        </span>
      </div>
      <ul className="paths">
        {library.paths.map((p) => (
          <li key={p}>
            <code>{p}</code>
          </li>
        ))}
      </ul>
      <p className="muted small">{status.data ? describe(status.data) : 'Never scanned'}</p>
      <div className="actions">
        <button
          type="button"
          className="button"
          onClick={() => scan.mutate()}
          disabled={status.data?.state === 'running'}
          data-testid="scan"
        >
          {status.data?.state === 'running' ? `Scanning… ${status.data.phase ?? ''}` : 'Scan now'}
        </button>
        <button type="button" className="button danger" onClick={onDelete} data-testid="delete">
          Delete
        </button>
      </div>
    </li>
  );
}

function describe(s: ScanStatus): string {
  if (s.state === 'running') return `Scanning (${s.phase}) · ${s.filesSeen} files seen`;
  if (s.error) return `Last scan failed: ${s.error}`;
  if (!s.finishedAt) return 'Never scanned';
  return `Last scan ${new Date(s.finishedAt).toLocaleString()} · ${s.filesSeen} files · ${s.itemsLinked} linked · ${s.itemsMatched} matched · ${s.itemsUnmatched} unmatched`;
}
