import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, unwrap, type Recording } from '../api/client.js';
import { LiveTabs } from '../components/LiveTabs.js';
import { fmtBytes, fmtClock, useRecordings } from '../hooks/useLive.js';
import { fmt } from './ItemPage.js';

const STATE_LABEL: Record<Recording['state'], string> = {
  scheduled: 'Scheduled',
  recording: 'Recording…',
  done: 'Done',
  failed: 'Failed',
};

/** Recordings the server made or will make: play, stop, cancel, delete. */
export function RecordingsPage() {
  const qc = useQueryClient();
  const recordings = useRecordings();
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['recordings'] });
  const stop = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.POST('/api/recordings/{id}/stop', { params: { path: { id } } })),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.DELETE('/api/recordings/{id}', { params: { path: { id } } })),
    onSuccess: invalidate,
  });
  const list = recordings.data ?? [];
  const upcoming = list.filter((r) => r.state === 'scheduled');
  const rest = list.filter((r) => r.state !== 'scheduled');
  return (
    <section className="page">
      <header className="page-head">
        <h1>Live TV</h1>
        <div className="page-tools">
          <span className="muted" data-testid="recording-count">
            {list.length} recordings
          </span>
        </div>
      </header>
      <LiveTabs active="recordings" />
      {recordings.isPending && <p className="muted">Loading…</p>}
      {recordings.isError && <p className="form-error">Could not load recordings.</p>}
      {recordings.isSuccess && list.length === 0 && (
        <p className="muted">
          Nothing recorded yet. Use ● Rec on a channel, or ● Record on a programme in the guide.
        </p>
      )}
      {(stop.error || remove.error) && (
        <p className="form-error">{((stop.error ?? remove.error) as Error).message}</p>
      )}
      {upcoming.length > 0 && (
        <>
          <h2>Scheduled</h2>
          <ul className="plain" data-testid="scheduled-list">
            {upcoming.map((r) => (
              <RecordingRow
                key={r.id}
                r={r}
                onStop={() => stop.mutate(r.id)}
                onDelete={() => remove.mutate(r.id)}
              />
            ))}
          </ul>
        </>
      )}
      {rest.length > 0 && (
        <>
          <h2>Recordings</h2>
          <ul className="plain" data-testid="recording-list">
            {rest.map((r) => (
              <RecordingRow
                key={r.id}
                r={r}
                onStop={() => stop.mutate(r.id)}
                onDelete={() => remove.mutate(r.id)}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function RecordingRow({
  r,
  onStop,
  onDelete,
}: {
  r: Recording;
  onStop: () => void;
  onDelete: () => void;
}) {
  const playable =
    r.state === 'done' || r.state === 'recording' || (r.state === 'failed' && r.sizeBytes > 0);
  const when = `${new Date(r.startAt).toLocaleDateString()} ${fmtClock(r.startAt)}${r.endAt ? `–${fmtClock(r.endAt)}` : ''}`;
  return (
    <li className="recording-row" data-testid={`recording-${r.id}`} data-state={r.state}>
      <span>
        <span className="guide-title">
          {r.title}{' '}
          <span className={`rec-state ${r.state}`} data-testid="rec-state">
            {STATE_LABEL[r.state]}
          </span>
        </span>
        <span className="muted small guide-desc">
          {r.channelName} · {when}
          {r.durationMs ? ` · ${fmt(r.durationMs)}` : ''}
          {r.sizeBytes > 0 ? ` · ${fmtBytes(r.sizeBytes)}` : ''}
          {r.error ? ` · ${r.error}` : ''}
        </span>
      </span>
      <span className="actions">
        {playable && (
          <Link
            to={`/live/recordings/${r.id}/watch`}
            className="button small primary"
            data-testid="play"
          >
            Play
          </Link>
        )}
        {r.state === 'recording' && (
          <button type="button" className="button small" onClick={onStop} data-testid="stop">
            Stop
          </button>
        )}
        {r.state === 'scheduled' && (
          <button type="button" className="button small" onClick={onStop} data-testid="cancel">
            Cancel
          </button>
        )}
        {r.state !== 'scheduled' && (
          <button
            type="button"
            className="button small danger"
            onClick={() => {
              if (window.confirm(`Delete "${r.title}"?`)) onDelete();
            }}
            data-testid="delete"
          >
            Delete
          </button>
        )}
      </span>
    </li>
  );
}
