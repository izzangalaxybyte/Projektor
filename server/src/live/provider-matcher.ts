// Matches provider VOD titles and series against TMDB, the same way local files are matched, so
// IPTV Movies and IPTV Series get posters, overviews, and proper titles.
import { eq, isNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import pLimit from 'p-limit';
import { now, schema, type Db } from '../db/index.js';
import type { ImageStore } from '../images/store.js';
import { ACCEPT_THRESHOLD, rankCandidates } from '../metadata/score.js';
import { TmdbClient, TmdbError } from '../metadata/tmdb.js';

export interface ProviderMatcherDeps {
  db: Db;
  images: ImageStore;
  /** Read at the start of every run so a key entered later is picked up. */
  tmdb: () => TmdbClient | null;
  log?: FastifyBaseLogger | undefined;
}

export interface ProviderMatchSummary {
  matched: number;
  unmatched: number;
  failed: number;
  skipped: boolean;
}

const yearOf = (date: string | null | undefined): number | null => {
  const y = date ? Number(date.slice(0, 4)) : NaN;
  return Number.isFinite(y) && y > 1800 ? y : null;
};

export class ProviderMatcher {
  private readonly limit = pLimit(2);
  private inFlight: Promise<ProviderMatchSummary> | null = null;
  running = false;

  constructor(private readonly deps: ProviderMatcherDeps) {}

  /** Matches every movie and series never attempted. Concurrent calls share one run. */
  matchPending(): Promise<ProviderMatchSummary> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run().finally(() => (this.inFlight = null));
    return this.inFlight;
  }

  private async run(): Promise<ProviderMatchSummary> {
    const tmdb = this.deps.tmdb();
    const summary: ProviderMatchSummary = { matched: 0, unmatched: 0, failed: 0, skipped: false };
    if (!tmdb) {
      summary.skipped = true;
      return summary;
    }
    this.running = true;
    let keyRejected = false;
    const { db } = this.deps;
    const movies = db
      .select({ id: schema.iptvMovies.id })
      .from(schema.iptvMovies)
      .where(isNull(schema.iptvMovies.matchAttemptedAt))
      .all();
    const series = db
      .select({ id: schema.iptvSeries.id })
      .from(schema.iptvSeries)
      .where(isNull(schema.iptvSeries.matchAttemptedAt))
      .all();
    const tally = async (run: () => Promise<boolean>) => {
      if (keyRejected) {
        summary.failed += 1;
        return;
      }
      try {
        if (await run()) summary.matched += 1;
        else summary.unmatched += 1;
      } catch (error) {
        summary.failed += 1;
        this.deps.log?.warn({ error: String(error) }, 'provider title match failed');
        if (error instanceof TmdbError && error.status === 401) keyRejected = true;
      }
    };
    try {
      await Promise.all([
        ...movies.map((m) => this.limit(() => tally(() => this.matchMovie(tmdb, m.id)))),
        ...series.map((s) => this.limit(() => tally(() => this.matchSeries(tmdb, s.id)))),
      ]);
    } finally {
      this.running = false;
    }
    if (movies.length + series.length > 0) this.deps.log?.info(summary, 'provider titles matched');
    return summary;
  }

  async matchMovie(tmdb: TmdbClient, id: string): Promise<boolean> {
    const { db } = this.deps;
    const row = db.select().from(schema.iptvMovies).where(eq(schema.iptvMovies.id, id)).get();
    if (!row) return false;
    const results = await tmdb.searchMovies(row.parsedTitle, row.parsedYear);
    const top = rankCandidates(
      row.parsedTitle,
      row.parsedYear,
      results.map((r) => ({
        id: r.id,
        titles: [r.title, r.original_title ?? ''],
        year: yearOf(r.release_date),
        popularity: r.popularity ?? 0,
      })),
    )[0];
    db.update(schema.iptvMovies)
      .set({ matchAttemptedAt: now() })
      .where(eq(schema.iptvMovies.id, id))
      .run();
    if (!top || top.score < ACCEPT_THRESHOLD) return false;
    const details = await tmdb.movie(top.candidate.id);
    const [posterKey, backdropKey] = await Promise.all([
      this.image(details.poster_path, 'poster'),
      this.image(details.backdrop_path, 'backdrop'),
    ]);
    db.update(schema.iptvMovies)
      .set({
        tmdbId: details.id,
        title: details.title,
        year: yearOf(details.release_date),
        overview: details.overview ?? null,
        genresJson: JSON.stringify((details.genres ?? []).map((g) => g.name)),
        rating: details.vote_average ?? null,
        runtimeMs: details.runtime ? details.runtime * 60_000 : null,
        posterKey,
        backdropKey,
        needsReview: false,
        updatedAt: now(),
      })
      .where(eq(schema.iptvMovies.id, id))
      .run();
    return true;
  }

  async matchSeries(tmdb: TmdbClient, id: string): Promise<boolean> {
    const { db } = this.deps;
    const row = db.select().from(schema.iptvSeries).where(eq(schema.iptvSeries.id, id)).get();
    if (!row) return false;
    const results = await tmdb.searchTv(row.parsedTitle, row.parsedYear);
    const top = rankCandidates(
      row.parsedTitle,
      row.parsedYear,
      results.map((r) => ({
        id: r.id,
        titles: [r.name, r.original_name ?? ''],
        year: yearOf(r.first_air_date),
        popularity: r.popularity ?? 0,
      })),
    )[0];
    db.update(schema.iptvSeries)
      .set({ matchAttemptedAt: now() })
      .where(eq(schema.iptvSeries.id, id))
      .run();
    if (!top || top.score < ACCEPT_THRESHOLD) return false;
    const details = await tmdb.tv(top.candidate.id);
    const [posterKey, backdropKey] = await Promise.all([
      this.image(details.poster_path, 'poster'),
      this.image(details.backdrop_path, 'backdrop'),
    ]);
    db.update(schema.iptvSeries)
      .set({
        tmdbId: details.id,
        title: details.name,
        year: yearOf(details.first_air_date),
        overview: details.overview ?? null,
        genresJson: JSON.stringify((details.genres ?? []).map((g) => g.name)),
        rating: details.vote_average ?? null,
        posterKey,
        backdropKey,
        needsReview: false,
        updatedAt: now(),
      })
      .where(eq(schema.iptvSeries.id, id))
      .run();
    return true;
  }

  private async image(
    imagePath: string | null | undefined,
    kind: 'poster' | 'backdrop',
  ): Promise<string | null> {
    if (!imagePath) return null;
    try {
      return await this.deps.images.ensure(TmdbClient.imageUrl(imagePath, kind));
    } catch (error) {
      this.deps.log?.warn({ imagePath, error: String(error) }, 'artwork download failed');
      return null;
    }
  }
}
