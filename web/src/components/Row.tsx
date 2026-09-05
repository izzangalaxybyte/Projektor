import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ItemSummary } from '../api/client.js';
import { PosterTile } from './PosterTile.js';

interface Props {
  title: string;
  items: ItemSummary[] | undefined;
  moreTo?: string;
  testId?: string;
  children?: ReactNode;
}

/** A titled horizontal strip of tiles. Renders nothing while empty. */
export function Row({ title, items, moreTo, testId }: Props) {
  if (!items || items.length === 0) return null;
  return (
    <section className="row" data-testid={testId}>
      <header className="row-head">
        <h2>{title}</h2>
        {moreTo && (
          <Link to={moreTo} className="muted">
            See all
          </Link>
        )}
      </header>
      <div className="row-scroll">
        {items.map((i) => (
          <PosterTile key={i.id} item={i} />
        ))}
      </div>
    </section>
  );
}
