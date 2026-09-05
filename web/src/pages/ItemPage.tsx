import { Link, useParams } from 'react-router-dom';
import { imageUrl, type ItemDetail, type MediaFile } from '../api/client.js';
import { Grid } from '../components/Grid.js';
import { subtitleFor, useChildren, useItem, useNextEpisode } from '../hooks/useItems.js';

export function ItemPage() {
  const { id } = useParams();
  const item = useItem(id);
  if (item.isPending) return <p className="muted">Loading…</p>;
  if (item.isError || !item.data)
    return <p className="form-error">This item could not be loaded.</p>;
  const d = item.data;
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
          {imageUrl(d.posterKey, 300) ? (
            <img src={imageUrl(d.posterKey, 300)!} alt="" />
          ) : (
            <div className="tile-placeholder big">{d.title.slice(0, 1)}</div>
          )}
        </div>
        <div className="detail-text">
          {d.showTitle && d.kind !== 'show' && <p className="muted crumb">{d.showTitle}</p>}
          <h1>{d.title}</h1>
          <p className="muted">
            {[
              subtitleFor(d),
              d.runtimeMs ? `${Math.round(d.runtimeMs / 60000)} min` : null,
              d.rating ? `★ ${d.rating.toFixed(1)}` : null,
              ...d.genres,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {d.tagline && <p className="tagline">{d.tagline}</p>}
          {d.overview && <p className="overview">{d.overview}</p>}
          {d.needsReview && (
            <p className="review-note">
              This title was matched from its file name only.{' '}
              <Link to={`/settings/review`} className="muted">
                Fix match
              </Link>
            </p>
          )}
          {d.files.length > 0 && <PlayActions detail={d} />}
          {d.kind === 'episode' && <NextEpisode id={d.id} />}
        </div>
      </div>
      <Children detail={d} />
      {d.files.map((f) => (
        <FileInfo key={f.id} file={f} />
      ))}
    </article>
  );
}

function PlayActions({ detail }: { detail: ItemDetail }) {
  const file = detail.files[0]!;
  const resume =
    detail.progress && !detail.progress.watched && detail.progress.positionMs > 5000
      ? detail.progress.positionMs
      : 0;
  return (
    <div className="actions">
      <Link
        to={`/play/${file.id}?item=${detail.id}${resume ? `&t=${resume}` : ''}`}
        className="button primary"
        data-testid="play"
      >
        {resume ? `Resume from ${fmt(resume)}` : 'Play'}
      </Link>
      {resume > 0 && (
        <Link to={`/play/${file.id}?item=${detail.id}`} className="button">
          Start over
        </Link>
      )}
    </div>
  );
}

function NextEpisode({ id }: { id: string }) {
  const next = useNextEpisode(id);
  if (!next.data) return null;
  return (
    <p className="muted">
      Next:{' '}
      <Link to={`/items/${next.data.id}`}>
        {subtitleFor(next.data)} {next.data.title}
      </Link>
    </p>
  );
}

function Children({ detail }: { detail: ItemDetail }) {
  const children = useChildren(
    detail.kind === 'show' || detail.kind === 'season' ? detail.id : undefined,
  );
  const list = children.data ?? detail.children;
  if (detail.kind !== 'show' && detail.kind !== 'season') return null;
  const seasons = list.filter((c) => c.kind === 'season');
  const episodes = list.filter((c) => c.kind === 'episode');
  return (
    <section className="page" data-testid="children">
      {seasons.length > 0 && (
        <>
          <h2>Seasons</h2>
          <Grid items={seasons} />
        </>
      )}
      {episodes.length > 0 && (
        <>
          <h2>Episodes</h2>
          <Grid items={episodes} wide />
        </>
      )}
    </section>
  );
}

function FileInfo({ file }: { file: MediaFile }) {
  const video = file.streams.filter((s) => s.type === 'video');
  const audio = file.streams.filter((s) => s.type === 'audio');
  return (
    <details className="file-info" data-testid="file-info">
      <summary>
        {file.fileName} · {file.container} · {fmt(file.durationMs)} ·{' '}
        {(file.sizeBytes / 1_048_576).toFixed(0)} MB
      </summary>
      <ul>
        {video.map((s) => (
          <li key={s.index}>
            Video: {s.codec} {s.width && s.height ? `${s.width}×${s.height}` : ''}
          </li>
        ))}
        {audio.map((s) => (
          <li key={s.index}>
            Audio: {s.codec} {s.channels ? `${s.channels}ch` : ''} {s.language ?? ''}{' '}
            {s.title ?? ''}
          </li>
        ))}
        {file.subtitles.map((s) => (
          <li key={s.id}>
            Subtitle: {s.format} {s.language ?? ''} {s.title ?? ''} ({s.source})
          </li>
        ))}
      </ul>
    </details>
  );
}

export function fmt(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}
