// Anime metadata: AniList for identity, titles, and cover art; TMDB for season structure and
// per-episode details. Absolute episode numbers from fansub names are mapped onto TMDB seasons.
import { randomUUID } from 'node:crypto';
import { and, eq, isNull, isNotNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import pLimit from 'p-limit';
import { now, schema, type Db } from '../db/index.js';
import type { ImageStore } from '../images/store.js';
import { mediaTitles, stripHtml, type AniListClient, type AniListMedia } from './anilist.js';
import { Matcher, sortTitle, type MatchSummary } from './matcher.js';
import { ACCEPT_THRESHOLD, rankCandidates } from './score.js';
import { mapAbsoluteEpisode } from './season-map.js';
import type { TmdbClient } from './tmdb.js';

export interface AnimeMatcherDeps {
  db: Db;
  anilist: AniListClient;
  /** Optional: without a TMDB key, shows get AniList metadata but no season mapping. */
  tmdb: TmdbClient | null;
  images: ImageStore;
  log?: FastifyBaseLogger | undefined;
}

export class AnimeMatcher {
  private readonly limit = pLimit(1);

  constructor(private readonly deps: AnimeMatcherDeps) {}

  /** Matches every show in an anime library that has never been attempted. */
  async matchPending(): Promise<MatchSummary> {
    const { db } = this.deps;
    const shows = db
      .select({ id: schema.shows.id })
      .from(schema.shows)
      .innerJoin(schema.libraries, eq(schema.libraries.id, schema.shows.libraryId))
      .where(and(isNull(schema.shows.matchAttemptedAt), eq(schema.libraries.kind, 'anime')))
      .all();
    const summary: MatchSummary = { matched: 0, unmatched: 0, failed: 0 };
    await Promise.all(
      shows.map((s) =>
        this.limit(async () => {
          try {
            if (await this.matchShow(s.id)) summary.matched += 1;
            else summary.unmatched += 1;
          } catch (error) {
            summary.failed += 1;
            this.deps.log?.warn({ showId: s.id, error: String(error) }, 'anime match failed');
          }
        }),
      ),
    );
    return summary;
  }

  async matchShow(showId: string): Promise<boolean> {
    const { db, anilist } = this.deps;
    const show = db.select().from(schema.shows).where(eq(schema.shows.id, showId)).get();
    if (!show) return false;
    const results = await anilist.search(show.title);
    const ranked = rankCandidates(
      show.title,
      show.year,
      results.map((m) => ({
        id: m.id,
        titles: mediaTitles(m),
        year: m.seasonYear ?? m.startDate?.year ?? null,
        popularity: m.popularity ?? 0,
        media: m,
      })),
    );
    db.update(schema.shows)
      .set({ matchAttemptedAt: now() })
      .where(eq(schema.shows.id, showId))
      .run();
    const top = ranked[0];
    if (!top || top.score < ACCEPT_THRESHOLD) return false;
    await this.applyAniList(showId, top.candidate.media);
    return true;
  }

  /** Writes AniList metadata to the show, then tries to attach TMDB season structure. */
  async applyAniList(showId: string, media: AniListMedia): Promise<void> {
    const { db, images } = this.deps;
    const title = media.title.english ?? media.title.romaji ?? media.title.native ?? 'Untitled';
    const cover = media.coverImage?.extraLarge ?? media.coverImage?.large ?? null;
    const [posterKey, backdropKey] = await Promise.all([
      cover ? images.ensure(cover).catch(() => null) : null,
      media.bannerImage ? images.ensure(media.bannerImage).catch(() => null) : null,
    ]);
    db.update(schema.shows)
      .set({
        anilistId: media.id,
        title,
        sortTitle: sortTitle(title),
        year: media.seasonYear ?? media.startDate?.year ?? null,
        overview: stripHtml(media.description),
        genresJson: JSON.stringify(media.genres),
        rating: media.averageScore != null ? media.averageScore / 10 : null,
        posterKey,
        backdropKey,
        needsReview: false,
        matchAttemptedAt: now(),
        updatedAt: now(),
      })
      .where(eq(schema.shows.id, showId))
      .run();
    await this.attachTmdb(
      showId,
      mediaTitles(media),
      media.seasonYear ?? media.startDate?.year ?? null,
    );
  }

  /** Finds the TMDB show for these titles and, if confident, maps absolute episodes onto its seasons. */
  async attachTmdb(showId: string, titles: string[], year: number | null): Promise<boolean> {
    const { tmdb, log } = this.deps;
    if (!tmdb) return false;
    const seen = new Map<
      number,
      { id: number; titles: string[]; year: number | null; popularity: number }
    >();
    for (const title of titles.slice(0, 2)) {
      for (const r of await tmdb.searchTv(title, year)) {
        const y = r.first_air_date ? Number(r.first_air_date.slice(0, 4)) : null;
        seen.set(r.id, {
          id: r.id,
          titles: [r.name, r.original_name ?? ''],
          year: Number.isFinite(y) ? y : null,
          popularity: r.popularity ?? 0,
        });
      }
    }
    let best: { id: number; score: number } | null = null;
    for (const title of titles.slice(0, 2)) {
      const top = rankCandidates(title, year, [...seen.values()])[0];
      if (top && (!best || top.score > best.score))
        best = { id: top.candidate.id, score: top.score };
    }
    if (!best || best.score < ACCEPT_THRESHOLD) {
      log?.info({ showId, titles }, 'no confident TMDB match for anime; episodes stay absolute');
      return false;
    }
    await this.applyTmdb(showId, best.id);
    return true;
  }

  /** Sets the TMDB id, maps absolute episodes to seasons, and fills episode details. */
  async applyTmdb(showId: string, tmdbId: number): Promise<void> {
    const { db, tmdb } = this.deps;
    if (!tmdb) return;
    const details = await tmdb.tv(tmdbId);
    const show = db.select().from(schema.shows).where(eq(schema.shows.id, showId)).get();
    if (!show) return;
    db.update(schema.shows)
      .set({ tmdbId: details.id, updatedAt: now() })
      .where(eq(schema.shows.id, showId))
      .run();
    this.remapAbsoluteEpisodes(showId, details.seasons ?? [], show.seasonOffset);
    const matcher = new Matcher({ db, tmdb, images: this.deps.images, log: this.deps.log });
    await matcher.refreshSeasons(showId, details);
  }

  /** Assigns seasonNumber/episodeNumber to every absolute-numbered episode of the show. */
  remapAbsoluteEpisodes(
    showId: string,
    tmdbSeasons: Array<{ season_number: number; episode_count: number }>,
    offset: number,
  ): void {
    const { db } = this.deps;
    const lengths = tmdbSeasons.map((s) => ({
      seasonNumber: s.season_number,
      episodeCount: s.episode_count,
    }));
    const episodes = db
      .select()
      .from(schema.episodes)
      .where(and(eq(schema.episodes.showId, showId), isNotNull(schema.episodes.absoluteNumber)))
      .all();
    for (const ep of episodes) {
      const mapped = mapAbsoluteEpisode(ep.absoluteNumber!, lengths, offset);
      if (!mapped) {
        db.update(schema.episodes)
          .set({ seasonId: null, seasonNumber: null, episodeNumber: null, updatedAt: now() })
          .where(eq(schema.episodes.id, ep.id))
          .run();
        continue;
      }
      let season = db
        .select({ id: schema.seasons.id })
        .from(schema.seasons)
        .where(
          and(
            eq(schema.seasons.showId, showId),
            eq(schema.seasons.seasonNumber, mapped.seasonNumber),
          ),
        )
        .get();
      if (!season) {
        season = { id: randomUUID() };
        db.insert(schema.seasons)
          .values({
            id: season.id,
            showId,
            seasonNumber: mapped.seasonNumber,
            title: `Season ${mapped.seasonNumber}`,
            createdAt: now(),
            updatedAt: now(),
          })
          .run();
      }
      db.update(schema.episodes)
        .set({
          seasonId: season.id,
          seasonNumber: mapped.seasonNumber,
          episodeNumber: mapped.episodeNumber,
          updatedAt: now(),
        })
        .where(eq(schema.episodes.id, ep.id))
        .run();
    }
  }
}
