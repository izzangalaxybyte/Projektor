// Scores and categories for anime from three places, so a library can be filtered by genre or tag
// and sorted by whichever audience score the viewer trusts: AniList (score, popularity, genres,
// tags, the MAL id), MyAnimeList through Jikan (score, age rating) and TMDB (vote average).
// Scores drift, so each show is refreshed once a week; a run happens in the background after a
// scan, shortly after start-up and every few hours.
import { and, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { now, schema, type Db } from '../db/index.js';
import { mediaTags, type AniListClient } from './anilist.js';
import type { JikanClient } from './jikan.js';
import type { TmdbClient } from './tmdb.js';

/** Scores out of ten by source, as stored in `shows.ratings_json`. */
export interface Ratings {
  anilist?: number | undefined;
  mal?: number | undefined;
  tmdb?: number | undefined;
}

export interface AnimeRatingsDeps {
  db: Db;
  anilist: AniListClient;
  jikan: JikanClient;
  tmdb: TmdbClient | null;
  log?: FastifyBaseLogger | undefined;
}

export interface RatingsSummary {
  refreshed: number;
  failed: number;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const running = new WeakMap<Db, Promise<RatingsSummary>>();

export function parseRatings(json: string): Ratings {
  try {
    return JSON.parse(json) as Ratings;
  } catch {
    return {};
  }
}

const score = (n: number | null | undefined): number | undefined =>
  n != null && n > 0 ? Math.round(n * 100) / 100 : undefined;

/**
 * Refreshes every matched anime show whose scores are missing or a week old. Only one run per
 * database at a time: a second call while one runs gets the same promise. Never rejects.
 */
export function refreshAnimeRatings(
  deps: AnimeRatingsDeps,
  stopped: () => boolean = () => false,
): Promise<RatingsSummary> {
  let run = running.get(deps.db);
  if (!run) {
    run = refresh(deps, stopped)
      .catch((error) => {
        deps.log?.warn({ error: String(error) }, 'anime ratings refresh failed');
        return { refreshed: 0, failed: 0 };
      })
      .finally(() => running.delete(deps.db));
    running.set(deps.db, run);
  }
  return run;
}

async function refresh(deps: AnimeRatingsDeps, stopped: () => boolean): Promise<RatingsSummary> {
  const { db, anilist, jikan, tmdb, log } = deps;
  const cutoff = new Date(Date.now() - WEEK_MS).toISOString();
  const shows = db
    .select({
      id: schema.shows.id,
      anilistId: schema.shows.anilistId,
      malId: schema.shows.malId,
      tmdbId: schema.shows.tmdbId,
      ratingsJson: schema.shows.ratingsJson,
    })
    .from(schema.shows)
    .innerJoin(schema.libraries, eq(schema.libraries.id, schema.shows.libraryId))
    .where(
      and(
        eq(schema.libraries.kind, 'anime'),
        isNotNull(schema.shows.anilistId),
        or(isNull(schema.shows.ratingsRefreshedAt), lt(schema.shows.ratingsRefreshedAt, cutoff)),
      ),
    )
    .all();
  const summary: RatingsSummary = { refreshed: 0, failed: 0 };
  if (shows.length === 0) return summary;
  log?.info({ shows: shows.length }, 'refreshing anime ratings');
  for (let i = 0; i < shows.length; i += 50) {
    if (stopped()) break;
    const chunk = shows.slice(i, i + 50);
    // Fifty shows a request from AniList; MAL and TMDB take one each.
    const media = await anilist.getMany(chunk.map((s) => s.anilistId!)).catch((error) => {
      log?.warn({ error: String(error) }, 'AniList ratings request failed');
      return [];
    });
    const byId = new Map(media.map((m) => [m.id, m]));
    for (const show of chunk) {
      if (stopped()) break;
      const ratings = parseRatings(show.ratingsJson);
      const m = byId.get(show.anilistId!);
      const malId = m?.idMal ?? show.malId;
      let ageRating: string | null | undefined;
      let ok = !!m;
      if (m) ratings.anilist = score(m.averageScore != null ? m.averageScore / 10 : null);
      if (malId) {
        try {
          const mal = await jikan.anime(malId);
          ratings.mal = score(mal?.score);
          ageRating = mal?.ageRating ?? null;
        } catch (error) {
          ok = false;
          log?.debug({ showId: show.id, malId, error: String(error) }, 'MAL score unavailable');
        }
      }
      if (tmdb && show.tmdbId) {
        try {
          ratings.tmdb = score((await tmdb.tv(show.tmdbId)).vote_average);
        } catch (error) {
          log?.debug({ showId: show.id, error: String(error) }, 'TMDB score unavailable');
        }
      }
      db.update(schema.shows)
        .set({
          ratingsJson: JSON.stringify(ratings),
          ...(m && {
            malId: m.idMal ?? show.malId,
            popularity: m.popularity ?? null,
            genresJson: JSON.stringify(m.genres),
            tagsJson: JSON.stringify(mediaTags(m)),
            rating: ratings.anilist ?? null,
          }),
          ...(ageRating !== undefined && { ageRating }),
          // A show that failed is tried again on the next run rather than in a week.
          ratingsRefreshedAt: ok ? now() : null,
          updatedAt: now(),
        })
        .where(eq(schema.shows.id, show.id))
        .run();
      if (ok) summary.refreshed += 1;
      else summary.failed += 1;
    }
  }
  log?.info(summary, 'anime ratings refreshed');
  return summary;
}
