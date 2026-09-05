import { desc, and, asc, eq, like, type SQL } from 'drizzle-orm';
import { schema, type Db } from '../db/index.js';
import type { ProgressService } from '../progress/service.js';
import type { SubtitleService } from '../subtitles/service.js';
import type { ItemDetail, ItemSummary, MediaFile, StreamInfo } from '../schemas/index.js';

export interface ItemsQueryInput {
  libraryKind?: 'movie' | 'tv' | 'anime' | undefined;
  kind?: 'movie' | 'show' | 'season' | 'episode' | undefined;
  parentId?: string | undefined;
  search?: string | undefined;
  needsReview?: boolean | undefined;
  sort: 'title' | 'year' | 'added' | 'lastPlayed';
  offset: number;
  limit: number;
}

export interface ItemsPage {
  items: ItemSummary[];
  total: number;
  offset: number;
  limit: number;
}

export class ItemNotFound extends Error {}

/** Read side for movies, shows, seasons, and episodes as the API presents them. */
export class ItemsService {
  constructor(
    private readonly db: Db,
    private readonly subtitles?: SubtitleService,
    private readonly progress?: ProgressService,
  ) {}

  list(q: ItemsQueryInput, userId?: string): ItemsPage {
    // Only top-level items (movies and shows) are listed unless a kind or parent is given.
    const wantMovies = q.kind ? q.kind === 'movie' : !q.parentId;
    const wantShows = q.kind ? q.kind === 'show' : !q.parentId;
    const wantSeasons = q.kind === 'season' || (!q.kind && !!q.parentId);
    const wantEpisodes = q.kind === 'episode' || (!q.kind && !!q.parentId);

    const ranked: Ranked[] = [];
    if (wantMovies && q.libraryKind !== 'tv' && q.libraryKind !== 'anime')
      ranked.push(...this.movies(q));
    if (wantShows && q.libraryKind !== 'movie') ranked.push(...this.shows(q));
    if (wantSeasons && q.parentId) ranked.push(...this.seasons(q.parentId));
    if (wantEpisodes && q.parentId) ranked.push(...this.episodes(q.parentId, q.parentId));
    const items = this.withProgress(sortItems(ranked, q.sort), userId);
    return {
      items: items.slice(q.offset, q.offset + q.limit),
      total: items.length,
      offset: q.offset,
      limit: q.limit,
    };
  }

  get(id: string, userId?: string): ItemDetail {
    const detail = this.detail(id);
    if (!userId) return detail;
    const [withSelf] = this.withProgress([detail], userId) as ItemDetail[];
    return { ...withSelf!, children: this.withProgress(detail.children, userId) };
  }

  /** Summaries for specific ids (any kind), in the given order, skipping unknown ids. */
  summaries(ids: string[], userId?: string): ItemSummary[] {
    const out: ItemSummary[] = [];
    for (const id of ids) {
      try {
        const {
          files: _f,
          children: _c,
          overview: _o,
          tagline: _t,
          genres: _g,
          rating: _r,
          airDate: _a,
          runtimeMs: _m,
          tmdbId: _x,
          anilistId: _y,
          ...summary
        } = this.detail(id);
        out.push(summary);
      } catch (error) {
        if (!(error instanceof ItemNotFound)) throw error;
      }
    }
    return this.withProgress(out, userId);
  }

  private withProgress<T extends ItemSummary>(items: T[], userId: string | undefined): T[] {
    if (!userId || !this.progress) return items;
    const map = this.progress.getMany(
      userId,
      items.filter((i) => i.kind === 'movie' || i.kind === 'episode').map((i) => i.id),
    );
    return items.map((i) => (map.has(i.id) ? { ...i, progress: map.get(i.id)! } : i));
  }

  private detail(id: string): ItemDetail {
    const movie = this.db.select().from(schema.movies).where(eq(schema.movies.id, id)).get();
    if (movie) {
      const lib = this.libraryKind(movie.libraryId);
      return {
        ...movieSummary(movie, lib).summary,
        overview: movie.overview,
        tagline: movie.tagline,
        genres: JSON.parse(movie.genresJson) as string[],
        rating: movie.rating,
        airDate: movie.releaseDate,
        runtimeMs: movie.runtimeMs,
        tmdbId: movie.tmdbId,
        anilistId: null,
        files: this.filesFor(eq(schema.mediaFiles.movieId, movie.id)),
        children: [],
      };
    }
    const show = this.db.select().from(schema.shows).where(eq(schema.shows.id, id)).get();
    if (show) {
      const lib = this.libraryKind(show.libraryId);
      return {
        ...showSummary(show, lib).summary,
        overview: show.overview,
        tagline: null,
        genres: JSON.parse(show.genresJson) as string[],
        rating: show.rating,
        airDate: show.firstAirDate,
        runtimeMs: null,
        tmdbId: show.tmdbId,
        anilistId: show.anilistId,
        files: [],
        children: [
          ...this.seasons(show.id).map((r) => r.summary),
          ...this.episodes(show.id, null)
            .filter((e) => e.summary.seasonNumber === null)
            .map((r) => r.summary),
        ],
      };
    }
    const season = this.db.select().from(schema.seasons).where(eq(schema.seasons.id, id)).get();
    if (season) {
      const parent = this.db
        .select()
        .from(schema.shows)
        .where(eq(schema.shows.id, season.showId))
        .get()!;
      const lib = this.libraryKind(parent.libraryId);
      return {
        ...seasonSummary(season, parent, lib).summary,
        overview: season.overview,
        tagline: null,
        genres: [],
        rating: null,
        airDate: null,
        runtimeMs: null,
        tmdbId: season.tmdbId,
        anilistId: null,
        files: [],
        children: this.episodes(parent.id, season.id).map((r) => r.summary),
      };
    }
    const episode = this.db.select().from(schema.episodes).where(eq(schema.episodes.id, id)).get();
    if (episode) {
      const parent = this.db
        .select()
        .from(schema.shows)
        .where(eq(schema.shows.id, episode.showId))
        .get()!;
      const lib = this.libraryKind(parent.libraryId);
      return {
        ...episodeSummary(episode, parent, lib).summary,
        overview: episode.overview,
        tagline: null,
        genres: [],
        rating: null,
        airDate: episode.airDate,
        runtimeMs: episode.runtimeMs,
        tmdbId: episode.tmdbId,
        anilistId: null,
        files: this.filesFor(eq(schema.mediaFiles.episodeId, episode.id)),
        children: [],
      };
    }
    throw new ItemNotFound(`No item ${id}`);
  }

  private libraryKind(libraryId: string): 'movie' | 'tv' | 'anime' {
    return this.db
      .select({ kind: schema.libraries.kind })
      .from(schema.libraries)
      .where(eq(schema.libraries.id, libraryId))
      .get()!.kind;
  }

  private movies(q: ItemsQueryInput): Ranked[] {
    const where = [
      q.libraryKind ? eq(schema.libraries.kind, q.libraryKind) : undefined,
      q.search ? like(schema.movies.title, `%${q.search}%`) : undefined,
      q.needsReview !== undefined ? eq(schema.movies.needsReview, q.needsReview) : undefined,
    ].filter((c): c is SQL => c !== undefined);
    return this.db
      .select({ movie: schema.movies, kind: schema.libraries.kind })
      .from(schema.movies)
      .innerJoin(schema.libraries, eq(schema.libraries.id, schema.movies.libraryId))
      .where(where.length ? and(...where) : undefined)
      .all()
      .map((r) => movieSummary(r.movie, r.kind));
  }

  private shows(q: ItemsQueryInput): Ranked[] {
    const where = [
      q.libraryKind ? eq(schema.libraries.kind, q.libraryKind) : undefined,
      q.search ? like(schema.shows.title, `%${q.search}%`) : undefined,
      q.needsReview !== undefined ? eq(schema.shows.needsReview, q.needsReview) : undefined,
    ].filter((c): c is SQL => c !== undefined);
    return this.db
      .select({ show: schema.shows, kind: schema.libraries.kind })
      .from(schema.shows)
      .innerJoin(schema.libraries, eq(schema.libraries.id, schema.shows.libraryId))
      .where(where.length ? and(...where) : undefined)
      .all()
      .map((r) => showSummary(r.show, r.kind));
  }

  private seasons(showId: string): Ranked[] {
    const show = this.db.select().from(schema.shows).where(eq(schema.shows.id, showId)).get();
    if (!show) return [];
    const lib = this.libraryKind(show.libraryId);
    return this.db
      .select()
      .from(schema.seasons)
      .where(eq(schema.seasons.showId, showId))
      .orderBy(asc(schema.seasons.seasonNumber))
      .all()
      .map((s) => seasonSummary(s, show, lib));
  }

  /** Episodes of a show; when parentId is a season id, only that season's. */
  private episodes(showOrSeasonId: string, seasonId: string | null): Ranked[] {
    const season = this.db
      .select()
      .from(schema.seasons)
      .where(eq(schema.seasons.id, showOrSeasonId))
      .get();
    const showId = season ? season.showId : showOrSeasonId;
    const show = this.db.select().from(schema.shows).where(eq(schema.shows.id, showId)).get();
    if (!show) return [];
    const lib = this.libraryKind(show.libraryId);
    const filter = season
      ? eq(schema.episodes.seasonId, season.id)
      : seasonId
        ? eq(schema.episodes.seasonId, seasonId)
        : eq(schema.episodes.showId, showId);
    return this.db
      .select()
      .from(schema.episodes)
      .where(filter)
      .orderBy(
        asc(schema.episodes.seasonNumber),
        asc(schema.episodes.episodeNumber),
        asc(schema.episodes.absoluteNumber),
      )
      .all()
      .map((e) => episodeSummary(e, show, lib));
  }

  private filesFor(condition: SQL): MediaFile[] {
    const files = this.db
      .select()
      .from(schema.mediaFiles)
      .where(and(condition, eq(schema.mediaFiles.missing, false)))
      // Largest first: with several versions, the full-size one is the default to play.
      .orderBy(desc(schema.mediaFiles.sizeBytes))
      .all();
    return files.map((f) => ({
      id: f.id,
      fileName: f.fileName,
      sizeBytes: f.sizeBytes,
      container: f.container ?? 'unknown',
      durationMs: f.durationMs ?? 0,
      bitrate: f.bitrate,
      subtitles: this.subtitles?.list(f.id) ?? [],
      streams: this.db
        .select()
        .from(schema.streams)
        .where(eq(schema.streams.fileId, f.id))
        .orderBy(asc(schema.streams.streamIndex))
        .all()
        .map((s): StreamInfo => ({
          index: s.streamIndex,
          type: s.type,
          codec: s.codec,
          language: s.language,
          title: s.title,
          isDefault: s.isDefault,
          isForced: s.isForced,
          bitDepth: s.bitDepth,
          hdr: s.hdr,
          width: s.width,
          height: s.height,
          channels: s.channels,
        })),
    }));
  }
}

type Movie = typeof schema.movies.$inferSelect;
type Show = typeof schema.shows.$inferSelect;
type Season = typeof schema.seasons.$inferSelect;
type Episode = typeof schema.episodes.$inferSelect;
type Kind = 'movie' | 'tv' | 'anime';

/** A summary plus the fields we sort on but do not expose. */
interface Ranked {
  summary: ItemSummary;
  added: string;
}

const base = { progress: null, seasonNumber: null, episodeNumber: null, showTitle: null } as const;

function movieSummary(m: Movie, libraryKind: Kind): Ranked {
  return {
    added: m.createdAt,
    summary: {
      ...base,
      id: m.id,
      kind: 'movie',
      libraryKind,
      title: m.title,
      year: m.year,
      posterKey: m.posterKey,
      backdropKey: m.backdropKey,
      needsReview: m.needsReview,
    },
  };
}
function showSummary(s: Show, libraryKind: Kind): Ranked {
  return {
    added: s.createdAt,
    summary: {
      ...base,
      id: s.id,
      kind: 'show',
      libraryKind,
      title: s.title,
      year: s.year,
      posterKey: s.posterKey,
      backdropKey: s.backdropKey,
      needsReview: s.needsReview,
    },
  };
}
function seasonSummary(s: Season, show: Show, libraryKind: Kind): Ranked {
  return {
    added: s.createdAt,
    summary: {
      ...base,
      id: s.id,
      kind: 'season',
      libraryKind,
      title: s.title ?? `Season ${s.seasonNumber}`,
      year: null,
      posterKey: s.posterKey ?? show.posterKey,
      backdropKey: show.backdropKey,
      seasonNumber: s.seasonNumber,
      showTitle: show.title,
      needsReview: false,
    },
  };
}
function episodeSummary(e: Episode, show: Show, libraryKind: Kind): Ranked {
  const number = e.episodeNumber ?? e.absoluteNumber;
  return {
    added: e.createdAt,
    summary: {
      ...base,
      id: e.id,
      kind: 'episode',
      libraryKind,
      title: e.title ?? (number !== null ? `Episode ${number}` : 'Unknown episode'),
      year: null,
      posterKey: e.stillKey ?? show.posterKey,
      backdropKey: show.backdropKey,
      seasonNumber: e.seasonNumber,
      episodeNumber: number,
      showTitle: show.title,
      needsReview: e.episodeNumber === null && e.absoluteNumber === null,
    },
  };
}

function sortItems(items: Ranked[], sort: ItemsQueryInput['sort']): ItemSummary[] {
  const sorted = [...items];
  if (sort === 'year')
    sorted.sort((a, b) => (b.summary.year ?? 0) - (a.summary.year ?? 0) || compareTitles(a, b));
  else if (sort === 'added' || sort === 'lastPlayed')
    sorted.sort((a, b) => b.added.localeCompare(a.added));
  else sorted.sort(compareTitles);
  return sorted.map((r) => r.summary);
}

const compareTitles = (a: Ranked, b: Ranked) =>
  a.summary.title.localeCompare(b.summary.title, undefined, { numeric: true, sensitivity: 'base' });
