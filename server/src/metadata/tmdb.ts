// Minimal TMDB v3 client. Accepts either a v3 API key or a v4 read access token.
import { z } from 'zod';

export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';
const API_BASE = 'https://api.themoviedb.org/3';

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const MovieSearchResult = z.object({
  id: z.number(),
  title: z.string(),
  original_title: z.string().optional(),
  release_date: z.string().optional(),
  popularity: z.number().optional(),
  poster_path: z.string().nullable().optional(),
});
const TvSearchResult = z.object({
  id: z.number(),
  name: z.string(),
  original_name: z.string().optional(),
  first_air_date: z.string().optional(),
  popularity: z.number().optional(),
  poster_path: z.string().nullable().optional(),
});
const SearchPage = <T extends z.ZodTypeAny>(item: T) => z.object({ results: item.array() });

export const MovieDetails = z.object({
  id: z.number(),
  title: z.string(),
  overview: z.string().nullable().optional(),
  tagline: z.string().nullable().optional(),
  release_date: z.string().nullable().optional(),
  runtime: z.number().nullable().optional(),
  vote_average: z.number().nullable().optional(),
  genres: z.object({ name: z.string() }).array().optional(),
  poster_path: z.string().nullable().optional(),
  backdrop_path: z.string().nullable().optional(),
});
export const TvDetails = z.object({
  id: z.number(),
  name: z.string(),
  overview: z.string().nullable().optional(),
  first_air_date: z.string().nullable().optional(),
  vote_average: z.number().nullable().optional(),
  genres: z.object({ name: z.string() }).array().optional(),
  poster_path: z.string().nullable().optional(),
  backdrop_path: z.string().nullable().optional(),
  seasons: z
    .object({
      season_number: z.number(),
      episode_count: z.number(),
      name: z.string().nullable().optional(),
      poster_path: z.string().nullable().optional(),
    })
    .array()
    .optional(),
});
export const SeasonDetails = z.object({
  season_number: z.number(),
  name: z.string().nullable().optional(),
  overview: z.string().nullable().optional(),
  poster_path: z.string().nullable().optional(),
  episodes: z
    .object({
      episode_number: z.number(),
      name: z.string().nullable().optional(),
      overview: z.string().nullable().optional(),
      air_date: z.string().nullable().optional(),
      still_path: z.string().nullable().optional(),
      runtime: z.number().nullable().optional(),
      id: z.number(),
    })
    .array(),
});

export type MovieSearchResult = z.infer<typeof MovieSearchResult>;
export type TvSearchResult = z.infer<typeof TvSearchResult>;
export type MovieDetails = z.infer<typeof MovieDetails>;
export type TvDetails = z.infer<typeof TvDetails>;
export type SeasonDetails = z.infer<typeof SeasonDetails>;

export class TmdbError extends Error {
  constructor(
    message: string,
    public readonly status: number | null = null,
  ) {
    super(message);
  }
}

export class TmdbClient {
  constructor(
    private readonly credential: string,
    private readonly fetcher: Fetcher = (url, init) => fetch(url, init),
  ) {}

  /** v4 tokens are JWTs and go in a header; v3 keys go in the query string. */
  private get usesBearer(): boolean {
    return this.credential.startsWith('ey') && this.credential.includes('.');
  }

  private async get<T>(
    pathname: string,
    params: Record<string, string | number | undefined>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const url = new URL(API_BASE + pathname);
    for (const [k, v] of Object.entries(params))
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    // Never let a slow upstream stall a scan: 15 seconds per request.
    const init: RequestInit = {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    };
    if (this.usesBearer)
      (init.headers as Record<string, string>)['authorization'] = `Bearer ${this.credential}`;
    else url.searchParams.set('api_key', this.credential);
    const res = await this.fetcher(url.toString(), init);
    if (res.status === 401) throw new TmdbError('TMDB rejected the API key', 401);
    if (res.status === 404) throw new TmdbError('TMDB: not found', 404);
    if (!res.ok) throw new TmdbError(`TMDB request failed with ${res.status}`, res.status);
    const parsed = schema.safeParse(await res.json());
    if (!parsed.success) throw new TmdbError('TMDB returned an unexpected shape');
    return parsed.data;
  }

  searchMovies(query: string, year?: number | null) {
    return this.get(
      '/search/movie',
      { query, year: year ?? undefined, include_adult: 'false' },
      SearchPage(MovieSearchResult),
    ).then((p) => p.results);
  }
  searchTv(query: string, year?: number | null) {
    return this.get(
      '/search/tv',
      { query, first_air_date_year: year ?? undefined, include_adult: 'false' },
      SearchPage(TvSearchResult),
    ).then((p) => p.results);
  }
  movie(id: number) {
    return this.get(`/movie/${id}`, {}, MovieDetails);
  }
  tv(id: number) {
    return this.get(`/tv/${id}`, {}, TvDetails);
  }
  season(tvId: number, seasonNumber: number) {
    return this.get(`/tv/${tvId}/season/${seasonNumber}`, {}, SeasonDetails);
  }

  /** Full URL for a TMDB image path at the largest size we cache. */
  static imageUrl(imagePath: string, kind: 'poster' | 'backdrop' | 'still'): string {
    const size = kind === 'backdrop' ? 'w1280' : 'w780';
    return `${TMDB_IMAGE_BASE}/${size}${imagePath}`;
  }
}
