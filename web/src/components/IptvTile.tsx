import { Link } from 'react-router-dom';
import { imageUrl } from '../api/client.js';

interface Props {
  to: string;
  title: string;
  year: number | null;
  posterKey: string | null;
  /** The provider's own image, used when TMDB gave us nothing. */
  fallbackUrl: string | null;
  needsReview: boolean;
  testId: string;
}

/** A poster tile for provider titles: cached TMDB art first, the provider's cover as fallback. */
export function IptvTile({ to, title, year, posterKey, fallbackUrl, needsReview, testId }: Props) {
  const src = imageUrl(posterKey, 300) ?? fallbackUrl;
  return (
    <Link to={to} className="tile" data-testid={testId} title={title}>
      <div className="tile-art">
        {src ? (
          <img src={src} alt="" loading="lazy" />
        ) : (
          <div className="tile-placeholder">{title.slice(0, 1)}</div>
        )}
        {needsReview && (
          <span
            className="tile-badge review"
            title="Not matched on TMDB; showing the provider's title"
          >
            ?
          </span>
        )}
      </div>
      <div className="tile-title">{title}</div>
      <div className="tile-sub">{year ?? ''}</div>
    </Link>
  );
}
