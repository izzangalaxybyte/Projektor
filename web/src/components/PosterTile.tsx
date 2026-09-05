import { Link } from 'react-router-dom';
import { imageUrl, type ItemSummary } from '../api/client.js';
import { subtitleFor } from '../hooks/useItems.js';

interface Props {
  item: ItemSummary;
  /** Episodes render wide (16:9 still); everything else as a portrait poster. */
  wide?: boolean;
}

export function PosterTile({ item, wide = item.kind === 'episode' }: Props) {
  const src = imageUrl(item.posterKey, wide ? 780 : 300);
  const percent =
    item.progress && !item.progress.watched
      ? Math.round((item.progress.positionMs / item.progress.durationMs) * 100)
      : 0;
  return (
    <Link
      to={`/items/${item.id}`}
      className={wide ? 'tile wide' : 'tile'}
      data-testid={`tile-${item.kind}`}
      title={item.title}
    >
      <div className="tile-art">
        {src ? (
          <img src={src} alt="" loading="lazy" />
        ) : (
          <div className="tile-placeholder">{item.title.slice(0, 1)}</div>
        )}
        {item.progress?.watched && <span className="tile-badge">✓</span>}
        {item.needsReview && (
          <span className="tile-badge review" title="Needs review">
            ?
          </span>
        )}
        {percent > 0 && (
          <div className="tile-progress">
            <div style={{ width: `${percent}%` }} />
          </div>
        )}
      </div>
      <div className="tile-title">{item.title}</div>
      <div className="tile-sub">{subtitleFor(item)}</div>
    </Link>
  );
}
