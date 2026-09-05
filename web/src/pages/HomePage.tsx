import {
  KIND_LABEL,
  KIND_PATH,
  useContinueWatching,
  useRecentlyAdded,
  type LibraryKind,
} from '../hooks/useItems.js';
import { Row } from '../components/Row.js';

const KINDS: LibraryKind[] = ['movie', 'tv', 'anime'];

export function HomePage() {
  const cont = {
    movie: useContinueWatching('movie'),
    tv: useContinueWatching('tv'),
    anime: useContinueWatching('anime'),
  };
  const recent = {
    movie: useRecentlyAdded('movie'),
    tv: useRecentlyAdded('tv'),
    anime: useRecentlyAdded('anime'),
  };
  const loading = KINDS.some((k) => recent[k].isPending);
  const empty =
    !loading &&
    KINDS.every((k) => (recent[k].data?.length ?? 0) === 0 && (cont[k].data?.length ?? 0) === 0);
  return (
    <section className="page">
      {KINDS.map((k) => (
        <Row
          key={`c-${k}`}
          title={`Continue watching · ${KIND_LABEL[k]}`}
          items={cont[k].data}
          testId={`continue-${k}`}
        />
      ))}
      {KINDS.map((k) => (
        <Row
          key={`r-${k}`}
          title={`Recently added · ${KIND_LABEL[k]}`}
          items={recent[k].data}
          moreTo={KIND_PATH[k]}
          testId={`recent-${k}`}
        />
      ))}
      {empty && (
        <p className="muted" data-testid="home-empty">
          Nothing here yet. Add a library in Settings and scan it.
        </p>
      )}
    </section>
  );
}
