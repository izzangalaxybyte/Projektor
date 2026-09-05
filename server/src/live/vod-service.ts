// Read side for IPTV Movies and IPTV Series, plus the on-demand episode fetch.
import { and, asc, desc, eq, like, sql } from 'drizzle-orm';
import { now, schema, type Db } from '../db/index.js';
import type { IptvEpisode, IptvMovie, IptvSeries, IptvSeriesDetail } from '../schemas/index.js';
import { flattenSeriesEpisodes, type XtreamClient } from './xtream.js';

export interface CatalogQuery {
  category?: string | undefined;
  search?: string | undefined;
  sort?: 'title' | 'added' | undefined;
  offset: number;
  limit: number;
}

/** How long a fetched episode list is trusted before asking the provider again. */
const EPISODES_TTL_MS = 24 * 3600_000;

export class VodService {
  constructor(private readonly db: Db) {}

  movies(q: CatalogQuery): { items: IptvMovie[]; total: number } {
    const t = schema.iptvMovies;
    const where = and(
      q.category ? eq(t.categoryId, q.category) : undefined,
      q.search ? like(t.title, `%${q.search.trim()}%`) : undefined,
    );
    const total = Number(
      this.db
        .select({ n: sql<number>`count(*)` })
        .from(t)
        .where(where)
        .get()?.n ?? 0,
    );
    const items = this.db
      .select()
      .from(t)
      .where(where)
      .orderBy(q.sort === 'added' ? desc(t.addedAt) : asc(t.title))
      .limit(q.limit)
      .offset(q.offset)
      .all()
      .map(toMovie);
    return { items, total };
  }

  movie(id: string): IptvMovie | null {
    const row = this.db.select().from(schema.iptvMovies).where(eq(schema.iptvMovies.id, id)).get();
    return row ? toMovie(row) : null;
  }

  series(q: CatalogQuery): { items: IptvSeries[]; total: number } {
    const t = schema.iptvSeries;
    const where = and(
      q.category ? eq(t.categoryId, q.category) : undefined,
      q.search ? like(t.title, `%${q.search.trim()}%`) : undefined,
    );
    const total = Number(
      this.db
        .select({ n: sql<number>`count(*)` })
        .from(t)
        .where(where)
        .get()?.n ?? 0,
    );
    const items = this.db
      .select()
      .from(t)
      .where(where)
      .orderBy(asc(t.title))
      .limit(q.limit)
      .offset(q.offset)
      .all()
      .map(toSeries);
    return { items, total };
  }

  /** The series with its episodes, pulling them from the provider when missing or stale. */
  async seriesDetail(id: string, client: XtreamClient | null): Promise<IptvSeriesDetail | null> {
    const row = this.db.select().from(schema.iptvSeries).where(eq(schema.iptvSeries.id, id)).get();
    if (!row) return null;
    const stale =
      !row.episodesFetchedAt ||
      Date.now() - new Date(row.episodesFetchedAt).getTime() > EPISODES_TTL_MS;
    if (stale && client) {
      try {
        const info = await client.seriesInfo(id);
        const episodes = flattenSeriesEpisodes(info);
        this.db.transaction((tx) => {
          tx.delete(schema.iptvEpisodes).where(eq(schema.iptvEpisodes.seriesId, id)).run();
          for (const e of episodes) {
            tx.insert(schema.iptvEpisodes)
              .values({
                id: e.id,
                seriesId: id,
                seasonNumber: e.seasonNumber,
                episodeNumber: e.episode_num,
                title: e.title || `Episode ${e.episode_num}`,
                containerExtension: e.container_extension || 'mp4',
                durationMs: e.info?.duration_secs ? Math.round(e.info.duration_secs * 1000) : null,
                overview: e.info?.plot || null,
                imageUrl: e.info?.movie_image || null,
              })
              .onConflictDoNothing()
              .run();
          }
          tx.update(schema.iptvSeries)
            .set({
              episodesFetchedAt: now(),
              overview: row.overview ?? info.info?.plot ?? null,
            })
            .where(eq(schema.iptvSeries.id, id))
            .run();
        });
      } catch {
        // Keep whatever we had; the route reports the cached list.
      }
    }
    const eps = this.db
      .select()
      .from(schema.iptvEpisodes)
      .where(eq(schema.iptvEpisodes.seriesId, id))
      .orderBy(asc(schema.iptvEpisodes.seasonNumber), asc(schema.iptvEpisodes.episodeNumber))
      .all()
      .map(toEpisode);
    const seasons = new Map<number, IptvEpisode[]>();
    for (const e of eps) seasons.set(e.seasonNumber, [...(seasons.get(e.seasonNumber) ?? []), e]);
    const fresh =
      this.db.select().from(schema.iptvSeries).where(eq(schema.iptvSeries.id, id)).get() ?? row;
    return {
      ...toSeries(fresh),
      seasons: [...seasons.entries()].map(([number, episodes]) => ({ number, episodes })),
    };
  }

  episode(id: string): { episode: IptvEpisode; series: IptvSeries } | null {
    const row = this.db
      .select()
      .from(schema.iptvEpisodes)
      .where(eq(schema.iptvEpisodes.id, id))
      .get();
    if (!row) return null;
    const s = this.db
      .select()
      .from(schema.iptvSeries)
      .where(eq(schema.iptvSeries.id, row.seriesId))
      .get();
    if (!s) return null;
    return { episode: toEpisode(row), series: toSeries(s) };
  }

  counts(): { movies: number; series: number } {
    const m =
      this.db
        .select({ n: sql<number>`count(*)` })
        .from(schema.iptvMovies)
        .get()?.n ?? 0;
    const s =
      this.db
        .select({ n: sql<number>`count(*)` })
        .from(schema.iptvSeries)
        .get()?.n ?? 0;
    return { movies: Number(m), series: Number(s) };
  }
}

const toMovie = (r: typeof schema.iptvMovies.$inferSelect): IptvMovie => ({
  id: r.id,
  title: r.title,
  year: r.year,
  overview: r.overview,
  genres: JSON.parse(r.genresJson) as string[],
  rating: r.rating,
  runtimeMs: r.runtimeMs,
  posterKey: r.posterKey,
  backdropKey: r.backdropKey,
  logoUrl: r.logoUrl,
  categoryId: r.categoryId,
  containerExtension: r.containerExtension,
  needsReview: r.needsReview,
  tmdbId: r.tmdbId,
  addedAt: r.addedAt,
});

const toSeries = (r: typeof schema.iptvSeries.$inferSelect): IptvSeries => ({
  id: r.id,
  title: r.title,
  year: r.year,
  overview: r.overview,
  genres: JSON.parse(r.genresJson) as string[],
  rating: r.rating,
  posterKey: r.posterKey,
  backdropKey: r.backdropKey,
  coverUrl: r.coverUrl,
  categoryId: r.categoryId,
  needsReview: r.needsReview,
  tmdbId: r.tmdbId,
});

const toEpisode = (r: typeof schema.iptvEpisodes.$inferSelect): IptvEpisode => ({
  id: r.id,
  seriesId: r.seriesId,
  seasonNumber: r.seasonNumber,
  episodeNumber: r.episodeNumber,
  title: r.title,
  overview: r.overview,
  imageUrl: r.imageUrl,
  durationMs: r.durationMs,
  containerExtension: r.containerExtension,
});
