import type { ItemSummary } from '../api/client.js';
import { PosterTile } from './PosterTile.js';

export function Grid({ items, wide = false }: { items: ItemSummary[]; wide?: boolean }) {
  return (
    <div className={wide ? 'grid wide' : 'grid'}>
      {items.map((i) => (
        <PosterTile key={i.id} item={i} wide={wide} />
      ))}
    </div>
  );
}
