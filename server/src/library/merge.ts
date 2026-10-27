// Folds together items that matched the same metadata entry. A show kept in two folders (a sub
// and a dub release, say) is identified twice, one show per folder, and both then match the same
// AniList or TMDB entry. They become one show whose episodes each carry every file, and the
// players ask which version to play.
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { now, schema, type Db } from '../db/index.js';

export interface MergeSummary {
  movies: number;
  shows: number;
}

type Episode = typeof schema.episodes.$inferSelect;

/** Merges every group of same-library movies or shows that share a metadata id. */
export function mergeDuplicates(db: Db, libraryId: string, log?: FastifyBaseLogger): MergeSummary {
  const summary: MergeSummary = { movies: 0, shows: 0 };
  db.transaction(() => {
    const movies = db
      .select()
      .from(schema.movies)
      .where(and(eq(schema.movies.libraryId, libraryId), isNotNull(schema.movies.tmdbId)))
      .all();
    for (const group of groupBy(movies, (m) => String(m.tmdbId))) {
      const [keep, ...rest] = byFiles(db, group, 'movie');
      for (const dup of rest) {
        db.update(schema.mediaFiles)
          .set({ movieId: keep!.id, updatedAt: now() })
          .where(eq(schema.mediaFiles.movieId, dup.id))
          .run();
        moveProgress(db, dup.id, keep!.id);
        db.delete(schema.movies).where(eq(schema.movies.id, dup.id)).run();
        summary.movies += 1;
        log?.info({ from: dup.title, into: keep!.title }, 'merged duplicate movie');
      }
    }

    const shows = db.select().from(schema.shows).where(eq(schema.shows.libraryId, libraryId)).all();
    const keyed = shows.filter((s) => s.anilistId !== null || s.tmdbId !== null);
    for (const group of groupBy(keyed, (s) =>
      s.anilistId !== null ? `a${s.anilistId}` : `t${s.tmdbId}`,
    )) {
      const [keep, ...rest] = byFiles(db, group, 'show');
      for (const dup of rest) {
        mergeShow(db, dup.id, keep!.id);
        summary.shows += 1;
        log?.info({ from: dup.title, into: keep!.title }, 'merged duplicate show');
      }
    }
  });
  return summary;
}

/** Moves every episode, file, and progress row of one show into another, then deletes it. */
export function mergeShow(db: Db, fromId: string, intoId: string): void {
  const target = db.select().from(schema.episodes).where(eq(schema.episodes.showId, intoId)).all();
  const seasons = new Map(
    db
      .select()
      .from(schema.seasons)
      .where(eq(schema.seasons.showId, intoId))
      .all()
      .map((s) => [s.seasonNumber, s.id]),
  );
  for (const ep of db
    .select()
    .from(schema.episodes)
    .where(eq(schema.episodes.showId, fromId))
    .all()) {
    const same = sameEpisode(ep, target);
    if (same) {
      db.update(schema.mediaFiles)
        .set({ episodeId: same.id, updatedAt: now() })
        .where(eq(schema.mediaFiles.episodeId, ep.id))
        .run();
      moveProgress(db, ep.id, same.id);
      db.delete(schema.episodes).where(eq(schema.episodes.id, ep.id)).run();
      continue;
    }
    let seasonId: string | null = null;
    if (ep.seasonNumber !== null) {
      seasonId = seasons.get(ep.seasonNumber) ?? null;
      if (!seasonId && ep.seasonId) {
        // The kept show has no such season yet: bring this one along.
        db.update(schema.seasons)
          .set({ showId: intoId, updatedAt: now() })
          .where(eq(schema.seasons.id, ep.seasonId))
          .run();
        seasons.set(ep.seasonNumber, ep.seasonId);
        seasonId = ep.seasonId;
      }
    }
    db.update(schema.episodes)
      .set({ showId: intoId, seasonId, updatedAt: now() })
      .where(eq(schema.episodes.id, ep.id))
      .run();
    target.push({ ...ep, showId: intoId, seasonId });
  }
  db.delete(schema.shows).where(eq(schema.shows.id, fromId)).run();
}

/**
 * The kept show's copy of an episode: same season and episode, or same absolute number. Episode
 * 0 and unnumbered files are never paired: they are specials and recaps, and two different OVAs
 * both numbered "00" must stay apart.
 */
function sameEpisode(ep: Episode, among: Episode[]): Episode | undefined {
  if (ep.seasonNumber !== null && ep.episodeNumber !== null && ep.episodeNumber > 0) {
    const hit = among.find(
      (t) => t.seasonNumber === ep.seasonNumber && t.episodeNumber === ep.episodeNumber,
    );
    if (hit) return hit;
  }
  if (ep.absoluteNumber !== null && ep.absoluteNumber > 0) {
    return among.find((t) => t.absoluteNumber === ep.absoluteNumber);
  }
  return undefined;
}

/** Re-points progress at the kept item; when a user has progress on both, the later one wins. */
function moveProgress(db: Db, fromId: string, intoId: string): void {
  const rows = db
    .select()
    .from(schema.playbackState)
    .where(inArray(schema.playbackState.itemId, [fromId, intoId]))
    .all();
  for (const row of rows.filter((r) => r.itemId === fromId)) {
    const existing = rows.find((r) => r.itemId === intoId && r.userId === row.userId);
    const pk = and(
      eq(schema.playbackState.userId, row.userId),
      eq(schema.playbackState.itemId, fromId),
    );
    if (existing && existing.updatedAt >= row.updatedAt) {
      db.delete(schema.playbackState).where(pk).run();
    } else {
      if (existing) {
        db.delete(schema.playbackState)
          .where(
            and(
              eq(schema.playbackState.userId, row.userId),
              eq(schema.playbackState.itemId, intoId),
            ),
          )
          .run();
      }
      db.update(schema.playbackState).set({ itemId: intoId }).where(pk).run();
    }
  }
}

/** Items ordered most files first (oldest first on a tie): the first is the one kept. */
function byFiles<T extends { id: string; createdAt: string }>(
  db: Db,
  items: T[],
  kind: 'movie' | 'show',
): T[] {
  const count = (id: string) =>
    kind === 'movie'
      ? db
          .select({ id: schema.mediaFiles.id })
          .from(schema.mediaFiles)
          .where(eq(schema.mediaFiles.movieId, id))
          .all().length
      : db
          .select({ id: schema.mediaFiles.id })
          .from(schema.mediaFiles)
          .innerJoin(schema.episodes, eq(schema.episodes.id, schema.mediaFiles.episodeId))
          .where(eq(schema.episodes.showId, id))
          .all().length;
  const counts = new Map(items.map((i) => [i.id, count(i.id)]));
  return [...items].sort(
    (a, b) => counts.get(b.id)! - counts.get(a.id)! || a.createdAt.localeCompare(b.createdAt),
  );
}

function groupBy<T>(items: T[], key: (item: T) => string): T[][] {
  const map = new Map<string, T[]>();
  for (const item of items) map.set(key(item), [...(map.get(key(item)) ?? []), item]);
  return [...map.values()].filter((g) => g.length > 1);
}
