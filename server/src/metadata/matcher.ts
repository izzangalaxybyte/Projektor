// Matches locally identified movies and shows against TMDB and fills in metadata and artwork.
import { and, eq, isNull, inArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import pLimit from 'p-limit';
import { now, schema, type Db } from '../db/index.js';
import type { ImageStore } from '../images/store.js';
import { ACCEPT_THRESHOLD, rankCandidates } from './score.js';
import { TmdbClient, TmdbError, type MovieDetails, type TvDetails } from './tmdb.js';

export interface MatchSummary {
  matched: number;
  unmatched: number;
  failed: number;
}

export interface MatcherDeps {
  db: Db;
  tmdb: TmdbClient;
  images: ImageStore;
  log?: FastifyBaseLogger | undefined;
}

const yearOf = (date: string | null | undefined): number | null => {
  const y = date ? Number(date.slice(0, 4)) : NaN;
  return Number.isFinite(y) && y > 1800 ? y : null;
};

export class Matcher {
  private readonly limit = pLimit(2);

  constructor(private readonly deps: MatcherDeps) {}

  /** Matches every movie and non-anime show that has never been attempted. */
  async matchPending(): Promise<MatchSummary> {
    const { db } = this.deps;
    const movies = db
      .select({ id: schema.movies.id })
      .from(schema.movies)
      .where(isNull(schema.movies.matchAttemptedAt))
      .all();
    const shows = db
      .select({ id: schema.shows.id })
      .from(schema.shows)
      .innerJoin(schema.libraries, eq(schema.libraries.id, schema.shows.libraryId))
      .where(and(isNull(schema.shows.matchAttemptedAt), inArray(schema.libraries.kind, ['tv'])))
      .all();
    const summary: MatchSummary = { matched: 0, unmatched: 0, failed: 0 };
    await Promise.all([
      ...movies.map((m) => this.limit(() => this.tally(summary, () => this.matchMovie(m.id)))),
      ...shows.map((s) => this.limit(() => this.tally(summary, () => this.matchShow(s.id)))),
    ]);
    return summary;
  }

  private async tally(summary: MatchSummary, run: () => Promise<boolean>): Promise<void> {
    try {
      if (await run()) summary.matched += 1;
      else summary.unmatched += 1;
    } catch (error) {
      summary.failed += 1;
      this.deps.log?.warn({ error: String(error) }, 'metadata match failed');
      // A key rejection would fail every item; stop hammering the API.
      if (error instanceof TmdbError && error.status === 401) this.limit.clearQueue();
    }
  }

  /** Searches TMDB for the movie's parsed title/year and applies the top result if confident. */
  async matchMovie(movieId: string): Promise<boolean> {
    const { db, tmdb } = this.deps;
    const movie = db.select().from(schema.movies).where(eq(schema.movies.id, movieId)).get();
    if (!movie) return false;
    const results = await tmdb.searchMovies(movie.title, movie.year);
    const ranked = rankCandidates(
      movie.title,
      movie.year,
      results.map((r) => ({
        id: r.id,
        titles: [r.title, r.original_title ?? ''],
        year: yearOf(r.release_date),
        popularity: r.popularity ?? 0,
        raw: r,
      })),
    );
    const top = ranked[0];
    db.update(schema.movies)
      .set({ matchAttemptedAt: now() })
      .where(eq(schema.movies.id, movieId))
      .run();
    if (!top || top.score < ACCEPT_THRESHOLD) return false;
    await this.applyMovie(movieId, top.candidate.id);
    return true;
  }

  /** Fetches full details for a TMDB movie id and writes them to the movie row. */
  async applyMovie(movieId: string, tmdbId: number): Promise<void> {
    const { db, tmdb } = this.deps;
    const details = await tmdb.movie(tmdbId);
    const [posterKey, backdropKey] = await Promise.all([
      this.image(details.poster_path, 'poster'),
      this.image(details.backdrop_path, 'backdrop'),
    ]);
    db.update(schema.movies)
      .set({
        tmdbId: details.id,
        title: details.title,
        sortTitle: sortTitle(details.title),
        year: yearOf(details.release_date),
        overview: details.overview ?? null,
        tagline: details.tagline || null,
        genresJson: JSON.stringify((details.genres ?? []).map((g) => g.name)),
        rating: details.vote_average ?? null,
        releaseDate: details.release_date || null,
        runtimeMs: details.runtime ? details.runtime * 60_000 : null,
        posterKey,
        backdropKey,
        needsReview: false,
        matchAttemptedAt: now(),
        updatedAt: now(),
      })
      .where(eq(schema.movies.id, movieId))
      .run();
  }

  async matchShow(showId: string): Promise<boolean> {
    const { db, tmdb } = this.deps;
    const show = db.select().from(schema.shows).where(eq(schema.shows.id, showId)).get();
    if (!show) return false;
    const results = await tmdb.searchTv(show.title, show.year);
    const ranked = rankCandidates(
      show.title,
      show.year,
      results.map((r) => ({
        id: r.id,
        titles: [r.name, r.original_name ?? ''],
        year: yearOf(r.first_air_date),
        popularity: r.popularity ?? 0,
      })),
    );
    const top = ranked[0];
    db.update(schema.shows)
      .set({ matchAttemptedAt: now() })
      .where(eq(schema.shows.id, showId))
      .run();
    if (!top || top.score < ACCEPT_THRESHOLD) return false;
    await this.applyShow(showId, top.candidate.id);
    return true;
  }

  /** Writes TMDB show details, then season and episode details for every season we have files for. */
  async applyShow(showId: string, tmdbId: number): Promise<void> {
    const { db, tmdb } = this.deps;
    const details = await tmdb.tv(tmdbId);
    const [posterKey, backdropKey] = await Promise.all([
      this.image(details.poster_path, 'poster'),
      this.image(details.backdrop_path, 'backdrop'),
    ]);
    db.update(schema.shows)
      .set({
        tmdbId: details.id,
        title: details.name,
        sortTitle: sortTitle(details.name),
        year: yearOf(details.first_air_date),
        overview: details.overview ?? null,
        genresJson: JSON.stringify((details.genres ?? []).map((g) => g.name)),
        rating: details.vote_average ?? null,
        firstAirDate: details.first_air_date || null,
        posterKey,
        backdropKey,
        needsReview: false,
        matchAttemptedAt: now(),
        updatedAt: now(),
      })
      .where(eq(schema.shows.id, showId))
      .run();
    await this.refreshSeasons(showId, details);
  }

  /** Pulls TMDB season data for each local season and fills the episodes that exist locally. */
  async refreshSeasons(showId: string, details: TvDetails): Promise<void> {
    const { db, tmdb, log } = this.deps;
    const localSeasons = db
      .select()
      .from(schema.seasons)
      .where(eq(schema.seasons.showId, showId))
      .all();
    const available = new Set((details.seasons ?? []).map((s) => s.season_number));
    for (const season of localSeasons) {
      if (!available.has(season.seasonNumber)) continue;
      let remote;
      try {
        remote = await tmdb.season(details.id, season.seasonNumber);
      } catch (error) {
        log?.warn(
          { showId, season: season.seasonNumber, error: String(error) },
          'season fetch failed',
        );
        continue;
      }
      const seasonPoster = await this.image(remote.poster_path, 'poster');
      db.update(schema.seasons)
        .set({
          title: remote.name || season.title,
          overview: remote.overview ?? null,
          posterKey: seasonPoster,
          tmdbId: details.id,
          updatedAt: now(),
        })
        .where(eq(schema.seasons.id, season.id))
        .run();
      const localEpisodes = db
        .select()
        .from(schema.episodes)
        .where(
          and(
            eq(schema.episodes.showId, showId),
            eq(schema.episodes.seasonNumber, season.seasonNumber),
          ),
        )
        .all();
      for (const ep of localEpisodes) {
        const match = remote.episodes.find((e) => e.episode_number === ep.episodeNumber);
        if (!match) continue;
        const stillKey = await this.image(match.still_path, 'still');
        db.update(schema.episodes)
          .set({
            title: match.name || ep.title,
            overview: match.overview ?? null,
            airDate: match.air_date || null,
            stillKey,
            runtimeMs: match.runtime ? match.runtime * 60_000 : null,
            tmdbId: match.id,
            updatedAt: now(),
          })
          .where(eq(schema.episodes.id, ep.id))
          .run();
      }
    }
  }

  private async image(
    imagePath: string | null | undefined,
    kind: 'poster' | 'backdrop' | 'still',
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

export function sortTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export type { MovieDetails };
