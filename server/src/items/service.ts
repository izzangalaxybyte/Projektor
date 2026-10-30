import { desc, and, asc, eq, inArray, type SQL } from 'drizzle-orm';
import { schema, type Db } from '../db/index.js';
import type { FavoritesService } from '../favorites/service.js';
import type { ProgressService } from '../progress/service.js';
import type { SubtitleService } from '../subtitles/service.js';
import { parseRatings } from '../metadata/anime-ratings.js';
import type {
  ItemDetail,
  ItemFacets,
  ItemRatings,
  ItemSummary,
  MediaFile,
  StreamInfo,
} from '../schemas/index.js';
import { matchesSearch } from '../search.js';

export interface ItemsQueryInput {
  libraryKind?: Kind | undefined;
  kind?: 'movie' | 'show' | 'season' | 'episode' | undefined;
  parentId?: string | undefined;
  search?: string | undefined;
  genre?: string | undefined;
  needsReview?: boolean | undefined;
  sort:
    | 'title'
    | 'year'
    | 'added'
    | 'lastPlayed'
    | 'rating'
    | 'anilist'
    | 'mal'
    | 'tmdb'
    | 'popularity';
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
    private readonly favorites?: FavoritesService,
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
    const wanted = (q.genre ?? '')
      .split(',')
      .map((g) => g.trim().toLowerCase())
      .filter(Boolean);
    const filtered = wanted.length
      ? ranked.filter((r) => wanted.every((g) => r.categories.has(g)))
      : ranked;
    const items = this.withUserState(sortItems(filtered, q.sort), userId);
    return {
      items: items.slice(q.offset, q.offset + q.limit),
      total: items.length,
      offset: q.offset,
      limit: q.limit,
    };
  }

  /** The genres and tags across a kind of library's movies and shows, for filter choices. */
  facets(libraryKind?: Kind): ItemFacets {
    const lists: Array<{ genres: string[]; tags: string[] }> = [];
    if (libraryKind !== 'tv' && libraryKind !== 'anime')
      for (const r of this.movies({ libraryKind, sort: 'title', offset: 0, limit: 0 }))
        lists.push({ genres: r.summary.genres, tags: [] });
    if (libraryKind !== 'movie')
      for (const r of this.db
        .select({ genres: schema.shows.genresJson, tags: schema.shows.tagsJson })
        .from(schema.shows)
        .innerJoin(schema.libraries, eq(schema.libraries.id, schema.shows.libraryId))
        .where(libraryKind ? eq(schema.libraries.kind, libraryKind) : undefined)
        .all())
        lists.push({
          genres: JSON.parse(r.genres) as string[],
          tags: JSON.parse(r.tags) as string[],
        });
    const count = (names: string[][], min: number) => {
      const counts = new Map<string, number>();
      for (const list of names)
        for (const n of new Set(list)) counts.set(n, (counts.get(n) ?? 0) + 1);
      return [...counts]
        .filter(([, c]) => c >= min)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name, c]) => ({ name, count: c }));
    };
    return {
      genres: count(
        lists.map((l) => l.genres),
        1,
      ),
      tags: count(
        lists.map((l) => l.tags),
        2,
      ).slice(0, 60),
    };
  }

  get(id: string, userId?: string): ItemDetail {
    const detail = this.detail(id);
    if (!userId) return detail;
    const [withSelf] = this.withUserState([detail], userId) as ItemDetail[];
    return { ...withSelf!, children: this.withUserState(detail.children, userId) };
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
          tags: _g,
          ageRating: _ar,
          popularity: _p,
          rating: _r,
          airDate: _a,
          tmdbId: _x,
          anilistId: _y,
          ...summary
        } = this.detail(id);
        out.push(summary);
      } catch (error) {
        if (!(error instanceof ItemNotFound)) throw error;
      }
    }
    return this.withUserState(out, userId);
  }

  private withUserState<T extends ItemSummary>(items: T[], userId: string | undefined): T[] {
    if (!userId) return items;
    const progress = this.progress?.getMany(
      userId,
      items.filter((i) => i.kind === 'movie' || i.kind === 'episode').map((i) => i.id),
    );
    const favorites = this.favorites?.getMany(
      userId,
      items.filter((i) => i.kind === 'movie' || i.kind === 'show').map((i) => i.id),
    );
    return items.map((i) => ({
      ...i,
      progress: progress?.get(i.id) ?? i.progress,
      favorite: favorites?.has(i.id) ?? i.favorite,
    }));
  }

  private detail(id: string): ItemDetail {
    const movie = this.db.select().from(schema.movies).where(eq(schema.movies.id, id)).get();
    if (movie) {
      const lib = this.libraryKind(movie.libraryId);
      return {
        ...movieSummary(movie, lib, this.fileDurations('movie', [movie.id]).get(movie.id)).summary,
        overview: movie.overview,
        tagline: movie.tagline,
        tags: [],
        ageRating: null,
        popularity: null,
        rating: movie.rating,
        airDate: movie.releaseDate,
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
        tags: JSON.parse(show.tagsJson) as string[],
        ageRating: show.ageRating,
        popularity: show.popularity,
        rating: show.rating,
        airDate: show.firstAirDate,
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
        tags: [],
        ageRating: null,
        popularity: null,
        rating: null,
        airDate: null,
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
        ...episodeSummary(
          episode,
          parent,
          lib,
          this.fileDurations('episode', [episode.id]).get(episode.id),
        ).summary,
        overview: episode.overview,
        tagline: null,
        tags: [],
        ageRating: null,
        popularity: null,
        rating: null,
        airDate: episode.airDate,
        tmdbId: episode.tmdbId,
        anilistId: null,
        files: this.filesFor(eq(schema.mediaFiles.episodeId, episode.id)),
        children: [],
      };
    }
    throw new ItemNotFound(`No item ${id}`);
  }

  private libraryKind(libraryId: string): Kind {
    return this.db
      .select({ kind: schema.libraries.kind })
      .from(schema.libraries)
      .where(eq(schema.libraries.id, libraryId))
      .get()!.kind;
  }

  private movies(q: ItemsQueryInput): Ranked[] {
    const where = [
      q.libraryKind ? eq(schema.libraries.kind, q.libraryKind) : undefined,
      q.needsReview !== undefined ? eq(schema.movies.needsReview, q.needsReview) : undefined,
    ].filter((c): c is SQL => c !== undefined);
    const rows = this.db
      .select({ movie: schema.movies, kind: schema.libraries.kind })
      .from(schema.movies)
      .innerJoin(schema.libraries, eq(schema.libraries.id, schema.movies.libraryId))
      .where(where.length ? and(...where) : undefined)
      .all()
      .filter((r) => !q.search || matchesSearch(r.movie.title, q.search));
    const durations = this.fileDurations(
      'movie',
      rows.map((r) => r.movie.id),
    );
    return rows.map((r) => movieSummary(r.movie, r.kind, durations.get(r.movie.id)));
  }

  private shows(q: ItemsQueryInput): Ranked[] {
    const where = [
      q.libraryKind ? eq(schema.libraries.kind, q.libraryKind) : undefined,
      q.needsReview !== undefined ? eq(schema.shows.needsReview, q.needsReview) : undefined,
    ].filter((c): c is SQL => c !== undefined);
    return this.db
      .select({ show: schema.shows, kind: schema.libraries.kind })
      .from(schema.shows)
      .innerJoin(schema.libraries, eq(schema.libraries.id, schema.shows.libraryId))
      .where(where.length ? and(...where) : undefined)
      .all()
      .filter((r) => !q.search || matchesSearch(r.show.title, q.search))
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
    const rows = this.db
      .select()
      .from(schema.episodes)
      .where(filter)
      .orderBy(
        asc(schema.episodes.seasonNumber),
        asc(schema.episodes.episodeNumber),
        asc(schema.episodes.absoluteNumber),
      )
      .all();
    const durations = this.fileDurations(
      'episode',
      rows.map((e) => e.id),
    );
    return rows.map((e) => episodeSummary(e, show, lib, durations.get(e.id)));
  }

  /** Longest present file per movie or episode, for items TMDB gave no runtime. */
  private fileDurations(kind: 'movie' | 'episode', ids: string[]): Map<string, number> {
    const map = new Map<string, number>();
    const column = kind === 'movie' ? schema.mediaFiles.movieId : schema.mediaFiles.episodeId;
    for (let i = 0; i < ids.length; i += 500) {
      const rows = this.db
        .select({ id: column, durationMs: schema.mediaFiles.durationMs })
        .from(schema.mediaFiles)
        .where(and(inArray(column, ids.slice(i, i + 500)), eq(schema.mediaFiles.missing, false)))
        .all();
      for (const r of rows) {
        if (r.id && r.durationMs && r.durationMs > (map.get(r.id) ?? 0))
          map.set(r.id, r.durationMs);
      }
    }
    return map;
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
type Kind = 'movie' | 'tv' | 'anime' | 'comic';

/** A summary plus the fields we sort on but do not expose. */
interface Ranked {
  summary: ItemSummary;
  added: string;
  /** Genres and tags, lowercased, for the genre filter. */
  categories: Set<string>;
  popularity: number | null;
}

const NO_RATINGS: ItemRatings = { anilist: null, mal: null, tmdb: null };

const base = {
  progress: null,
  favorite: false,
  seasonNumber: null,
  episodeNumber: null,
  showTitle: null,
  runtimeMs: null,
  genres: [] as string[],
  ratings: NO_RATINGS,
};
const unranked = { categories: new Set<string>(), popularity: null };

const lower = (names: string[]) => new Set(names.map((n) => n.toLowerCase()));

function movieSummary(m: Movie, libraryKind: Kind, fileDurationMs?: number): Ranked {
  const genres = JSON.parse(m.genresJson) as string[];
  return {
    added: m.createdAt,
    categories: lower(genres),
    popularity: null,
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
      runtimeMs: m.runtimeMs ?? fileDurationMs ?? null,
      genres,
      // A movie's rating is TMDB's vote average.
      ratings: { ...NO_RATINGS, tmdb: m.rating },
    },
  };
}
function showSummary(s: Show, libraryKind: Kind): Ranked {
  const genres = JSON.parse(s.genresJson) as string[];
  const tags = JSON.parse(s.tagsJson) as string[];
  const stored = parseRatings(s.ratingsJson);
  // Before its first refresh an anime show's rating is AniList's; a TV show's is TMDB's.
  const ratings: ItemRatings = {
    anilist: stored.anilist ?? (s.anilistId ? s.rating : null),
    mal: stored.mal ?? null,
    tmdb: stored.tmdb ?? (s.anilistId ? null : s.rating),
  };
  return {
    added: s.createdAt,
    categories: lower([...genres, ...tags]),
    popularity: s.popularity,
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
      genres,
      ratings,
    },
  };
}
function seasonSummary(s: Season, show: Show, libraryKind: Kind): Ranked {
  return {
    ...unranked,
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
function episodeSummary(
  e: Episode,
  show: Show,
  libraryKind: Kind,
  fileDurationMs?: number,
): Ranked {
  const number = e.episodeNumber ?? e.absoluteNumber;
  return {
    ...unranked,
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
      runtimeMs: e.runtimeMs ?? fileDurationMs ?? null,
    },
  };
}

/** The score a sort orders by; null sorts last. */
function scoreFor(r: Ranked, sort: ItemsQueryInput['sort']): number | null {
  const { anilist, mal, tmdb } = r.summary.ratings;
  switch (sort) {
    case 'rating':
      return anilist ?? mal ?? tmdb;
    case 'anilist':
      return anilist;
    case 'mal':
      return mal;
    case 'tmdb':
      return tmdb;
    case 'popularity':
      return r.popularity;
    default:
      return null;
  }
}

const SCORED = new Set(['rating', 'anilist', 'mal', 'tmdb', 'popularity']);

function sortItems(items: Ranked[], sort: ItemsQueryInput['sort']): ItemSummary[] {
  const sorted = [...items];
  if (SCORED.has(sort))
    sorted.sort((a, b) => {
      const x = scoreFor(a, sort);
      const y = scoreFor(b, sort);
      if (x === null || y === null) return x === y ? compareTitles(a, b) : x === null ? 1 : -1;
      return y - x || compareTitles(a, b);
    });
  else if (sort === 'year')
    sorted.sort((a, b) => (b.summary.year ?? 0) - (a.summary.year ?? 0) || compareTitles(a, b));
  else if (sort === 'added' || sort === 'lastPlayed')
    sorted.sort((a, b) => b.added.localeCompare(a.added));
  else sorted.sort(compareNatural);
  return sorted.map((r) => r.summary);
}

/**
 * Default order: seasons, then episodes, as the query returned them (by season and episode
 * number); movies and shows by title. Sorting episodes by title listed "A Chance to Blossom" first.
 */
const NUMBERED = new Set(['season', 'episode']);
const compareNatural = (a: Ranked, b: Ranked) => {
  const an = NUMBERED.has(a.summary.kind);
  const bn = NUMBERED.has(b.summary.kind);
  if (an && bn) return a.summary.kind === b.summary.kind ? 0 : a.summary.kind === 'season' ? -1 : 1;
  if (an !== bn) return an ? 1 : -1;
  return compareTitles(a, b);
};

const compareTitles = (a: Ranked, b: Ranked) =>
  a.summary.title.localeCompare(b.summary.title, undefined, { numeric: true, sensitivity: 'base' });
