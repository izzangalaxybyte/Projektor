// Per-user playback position, watched state, continue watching, and next episode.
import { and, desc, eq, inArray } from 'drizzle-orm';
import { now, schema, type Db } from '../db/index.js';
import type { ProgressState } from '../schemas/index.js';

/** Positions at or past this fraction of the duration count as watched. */
export const WATCHED_FRACTION = 0.9;

export class ProgressError extends Error {
  constructor(
    public readonly statusCode: 404,
    message: string,
  ) {
    super(message);
  }
}

export class ProgressService {
  constructor(private readonly db: Db) {}

  /** Records a position. Crossing WATCHED_FRACTION marks the item watched; it stays watched afterwards. */
  update(userId: string, itemId: string, positionMs: number, durationMs: number): ProgressState {
    const kind = this.kindOf(itemId);
    const existing = this.db
      .select()
      .from(schema.playbackState)
      .where(and(eq(schema.playbackState.userId, userId), eq(schema.playbackState.itemId, itemId)))
      .get();
    const watched = (existing?.watched ?? false) || positionMs / durationMs >= WATCHED_FRACTION;
    const row = {
      userId,
      itemId,
      itemKind: kind,
      positionMs,
      durationMs,
      watched,
      updatedAt: now(),
    };
    this.db
      .insert(schema.playbackState)
      .values(row)
      .onConflictDoUpdate({
        target: [schema.playbackState.userId, schema.playbackState.itemId],
        set: { positionMs, durationMs, watched, updatedAt: row.updatedAt },
      })
      .run();
    return { positionMs, durationMs, watched, updatedAt: row.updatedAt };
  }

  /** Explicitly marks an item watched (position at the end) or unwatched (state removed). */
  setWatched(userId: string, itemId: string, watched: boolean): ProgressState | null {
    const kind = this.kindOf(itemId);
    if (!watched) {
      this.db
        .delete(schema.playbackState)
        .where(
          and(eq(schema.playbackState.userId, userId), eq(schema.playbackState.itemId, itemId)),
        )
        .run();
      return null;
    }
    const existing = this.db
      .select()
      .from(schema.playbackState)
      .where(and(eq(schema.playbackState.userId, userId), eq(schema.playbackState.itemId, itemId)))
      .get();
    const durationMs = existing?.durationMs ?? this.durationOf(itemId) ?? 1;
    const row = {
      userId,
      itemId,
      itemKind: kind,
      positionMs: durationMs,
      durationMs,
      watched: true,
      updatedAt: now(),
    };
    this.db
      .insert(schema.playbackState)
      .values(row)
      .onConflictDoUpdate({
        target: [schema.playbackState.userId, schema.playbackState.itemId],
        set: { positionMs: durationMs, durationMs, watched: true, updatedAt: row.updatedAt },
      })
      .run();
    return { positionMs: durationMs, durationMs, watched: true, updatedAt: row.updatedAt };
  }

  get(userId: string, itemId: string): ProgressState | null {
    const row = this.db
      .select()
      .from(schema.playbackState)
      .where(and(eq(schema.playbackState.userId, userId), eq(schema.playbackState.itemId, itemId)))
      .get();
    return row
      ? {
          positionMs: row.positionMs,
          durationMs: row.durationMs,
          watched: row.watched,
          updatedAt: row.updatedAt,
        }
      : null;
  }

  /** Progress for many items at once, for list endpoints. */
  getMany(userId: string, itemIds: string[]): Map<string, ProgressState> {
    const out = new Map<string, ProgressState>();
    if (itemIds.length === 0) return out;
    for (const row of this.db
      .select()
      .from(schema.playbackState)
      .where(
        and(eq(schema.playbackState.userId, userId), inArray(schema.playbackState.itemId, itemIds)),
      )
      .all()) {
      out.set(row.itemId, {
        positionMs: row.positionMs,
        durationMs: row.durationMs,
        watched: row.watched,
        updatedAt: row.updatedAt,
      });
    }
    return out;
  }

  /** Ids of in-progress (not watched) items, most recently played first. */
  continueWatching(userId: string, limit = 50): string[] {
    return this.db
      .select({ itemId: schema.playbackState.itemId })
      .from(schema.playbackState)
      .where(and(eq(schema.playbackState.userId, userId), eq(schema.playbackState.watched, false)))
      .orderBy(desc(schema.playbackState.updatedAt))
      .limit(limit)
      .all()
      .map((r) => r.itemId);
  }

  /**
   * The episode after this one in the show: next number in the same season, else the first
   * episode of the next season. Anime without seasons follows absolute numbers. Null at the end.
   */
  nextEpisode(episodeId: string): string | null {
    const current = this.db
      .select()
      .from(schema.episodes)
      .where(eq(schema.episodes.id, episodeId))
      .get();
    if (!current) throw new ProgressError(404, 'No such episode');
    const all = this.db
      .select()
      .from(schema.episodes)
      .where(eq(schema.episodes.showId, current.showId))
      .all();
    const ordered = all
      .filter(
        (e) => (e.seasonNumber !== null && e.episodeNumber !== null) || e.absoluteNumber !== null,
      )
      .sort((a, b) => sortKey(a) - sortKey(b) || (a.absoluteNumber ?? 0) - (b.absoluteNumber ?? 0));
    const index = ordered.findIndex((e) => e.id === current.id);
    if (index === -1) return null;
    return ordered[index + 1]?.id ?? null;
  }

  private kindOf(itemId: string): 'movie' | 'episode' {
    if (
      this.db
        .select({ id: schema.movies.id })
        .from(schema.movies)
        .where(eq(schema.movies.id, itemId))
        .get()
    )
      return 'movie';
    if (
      this.db
        .select({ id: schema.episodes.id })
        .from(schema.episodes)
        .where(eq(schema.episodes.id, itemId))
        .get()
    )
      return 'episode';
    throw new ProgressError(404, 'Progress can only be recorded for movies and episodes');
  }

  private durationOf(itemId: string): number | null {
    const byMovie = this.db
      .select({ d: schema.mediaFiles.durationMs })
      .from(schema.mediaFiles)
      .where(eq(schema.mediaFiles.movieId, itemId))
      .get();
    const byEpisode = this.db
      .select({ d: schema.mediaFiles.durationMs })
      .from(schema.mediaFiles)
      .where(eq(schema.mediaFiles.episodeId, itemId))
      .get();
    return byMovie?.d ?? byEpisode?.d ?? null;
  }
}

/** Season-major ordering; specials (season 0) first, season-less anime by absolute number at the end. */
function sortKey(e: typeof schema.episodes.$inferSelect): number {
  if (e.seasonNumber !== null && e.episodeNumber !== null)
    return e.seasonNumber * 10_000 + e.episodeNumber;
  return 1_000_000_000 + (e.absoluteNumber ?? 0);
}
