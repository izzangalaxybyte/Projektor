// Manual correction of a metadata match: search candidates, then apply a chosen id.
import { eq } from 'drizzle-orm';
import { now, schema, type Db } from '../db/index.js';
import type { MatchCandidate } from '../schemas/index.js';
import { mediaTitles, stripHtml } from './anilist.js';
import type { MetadataDeps } from './deps.js';
import { rankCandidates } from './score.js';
import { TmdbClient } from './tmdb.js';

export class FixMatchError extends Error {
  constructor(
    public readonly statusCode: 400 | 404,
    message: string,
  ) {
    super(message);
  }
}

type Target =
  | { kind: 'movie'; row: typeof schema.movies.$inferSelect }
  | { kind: 'show'; row: typeof schema.shows.$inferSelect; anime: boolean };

export class FixMatchService {
  constructor(
    private readonly db: Db,
    private readonly deps: MetadataDeps,
  ) {}

  private target(itemId: string): Target {
    const movie = this.db.select().from(schema.movies).where(eq(schema.movies.id, itemId)).get();
    if (movie) return { kind: 'movie', row: movie };
    const show = this.db.select().from(schema.shows).where(eq(schema.shows.id, itemId)).get();
    if (show) {
      const lib = this.db
        .select({ kind: schema.libraries.kind })
        .from(schema.libraries)
        .where(eq(schema.libraries.id, show.libraryId))
        .get();
      return { kind: 'show', row: show, anime: lib?.kind === 'anime' };
    }
    throw new FixMatchError(404, 'Only movies and shows can be re-matched');
  }

  /** Search results from the sources that apply to this item, best first. */
  async candidates(
    itemId: string,
    query: string | undefined,
    year: number | undefined,
  ): Promise<MatchCandidate[]> {
    const target = this.target(itemId);
    const q = query?.trim() || target.row.title;
    const y = year ?? target.row.year;
    const out: MatchCandidate[] = [];

    if (target.kind === 'show' && target.anime) {
      const media = await this.deps.anilist.search(q);
      const ranked = rankCandidates(
        q,
        y,
        media.map((m) => ({
          id: m.id,
          titles: mediaTitles(m),
          year: m.seasonYear ?? m.startDate?.year ?? null,
          popularity: m.popularity ?? 0,
          m,
        })),
      );
      out.push(
        ...ranked.map((r) => ({
          source: 'anilist' as const,
          id: r.candidate.id,
          title: r.candidate.m.title.english ?? r.candidate.m.title.romaji ?? '',
          year: r.candidate.year,
          overview: stripHtml(r.candidate.m.description),
          posterUrl:
            r.candidate.m.coverImage?.large ?? r.candidate.m.coverImage?.extraLarge ?? null,
          score: round(r.score),
        })),
      );
    }
    if (this.deps.tmdb) {
      if (target.kind === 'movie') {
        const results = await this.deps.tmdb.searchMovies(q, y);
        const ranked = rankCandidates(
          q,
          y,
          results.map((r) => ({
            id: r.id,
            titles: [r.title, r.original_title ?? ''],
            year: yearOf(r.release_date),
            popularity: r.popularity ?? 0,
            r,
          })),
        );
        out.push(
          ...ranked.map((r) => ({
            source: 'tmdb' as const,
            id: r.candidate.id,
            title: r.candidate.r.title,
            year: r.candidate.year,
            overview: null,
            posterUrl: poster(r.candidate.r.poster_path),
            score: round(r.score),
          })),
        );
      } else {
        const results = await this.deps.tmdb.searchTv(q, y);
        const ranked = rankCandidates(
          q,
          y,
          results.map((r) => ({
            id: r.id,
            titles: [r.name, r.original_name ?? ''],
            year: yearOf(r.first_air_date),
            popularity: r.popularity ?? 0,
            r,
          })),
        );
        out.push(
          ...ranked.map((r) => ({
            source: 'tmdb' as const,
            id: r.candidate.id,
            title: r.candidate.r.name,
            year: r.candidate.year,
            overview: null,
            posterUrl: poster(r.candidate.r.poster_path),
            score: round(r.score),
          })),
        );
      }
    }
    return out;
  }

  /** Applies a chosen match. At least one of tmdbId, anilistId, seasonOffset must be given. */
  async apply(
    itemId: string,
    input: {
      tmdbId?: number | undefined;
      anilistId?: number | undefined;
      seasonOffset?: number | undefined;
    },
  ): Promise<void> {
    const target = this.target(itemId);
    if (
      input.tmdbId === undefined &&
      input.anilistId === undefined &&
      input.seasonOffset === undefined
    ) {
      throw new FixMatchError(400, 'Provide tmdbId, anilistId, or seasonOffset');
    }
    if (input.tmdbId !== undefined && !this.deps.tmdb)
      throw new FixMatchError(400, 'TMDB API key is not configured');

    if (target.kind === 'movie') {
      if (input.anilistId !== undefined || input.seasonOffset !== undefined)
        throw new FixMatchError(400, 'Movies only accept tmdbId');
      await this.deps.matcher!.applyMovie(itemId, input.tmdbId!);
      return;
    }

    if (!target.anime) {
      if (input.anilistId !== undefined || input.seasonOffset !== undefined)
        throw new FixMatchError(400, 'TV shows only accept tmdbId');
      await this.deps.matcher!.applyShow(itemId, input.tmdbId!);
      return;
    }

    // Anime: offset first so any remap below uses it.
    if (input.seasonOffset !== undefined) {
      this.db
        .update(schema.shows)
        .set({ seasonOffset: input.seasonOffset, updatedAt: now() })
        .where(eq(schema.shows.id, itemId))
        .run();
    }
    if (input.anilistId !== undefined) {
      const media = await this.deps.anilist.get(input.anilistId);
      await this.deps.animeMatcher.applyAniList(itemId, media);
    }
    if (input.tmdbId !== undefined) {
      await this.deps.animeMatcher.applyTmdb(itemId, input.tmdbId);
    } else if (input.anilistId === undefined && input.seasonOffset !== undefined) {
      // Offset changed on its own: remap against the TMDB show already attached, if any.
      const show = this.db.select().from(schema.shows).where(eq(schema.shows.id, itemId)).get()!;
      if (show.tmdbId !== null && this.deps.tmdb)
        await this.deps.animeMatcher.applyTmdb(itemId, show.tmdbId);
    }
  }
}

const round = (n: number) => Math.round(n * 100) / 100;
const yearOf = (d: string | null | undefined) => {
  const y = d ? Number(d.slice(0, 4)) : NaN;
  return Number.isFinite(y) ? y : null;
};
const poster = (p: string | null | undefined) => (p ? TmdbClient.imageUrl(p, 'poster') : null);
