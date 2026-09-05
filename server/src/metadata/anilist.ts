// Minimal AniList GraphQL client. No API key required; rate limit is 90 requests a minute.
import { z } from 'zod';

const ENDPOINT = 'https://graphql.anilist.co';
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const Media = z.object({
  id: z.number(),
  idMal: z.number().nullable().optional(),
  title: z.object({
    romaji: z.string().nullable(),
    english: z.string().nullable(),
    native: z.string().nullable(),
  }),
  synonyms: z.string().array().optional().default([]),
  format: z.string().nullable().optional(),
  episodes: z.number().nullable().optional(),
  seasonYear: z.number().nullable().optional(),
  startDate: z.object({ year: z.number().nullable() }).nullable().optional(),
  description: z.string().nullable().optional(),
  genres: z.string().array().optional().default([]),
  averageScore: z.number().nullable().optional(),
  popularity: z.number().nullable().optional(),
  coverImage: z
    .object({ extraLarge: z.string().nullable(), large: z.string().nullable() })
    .nullable()
    .optional(),
  bannerImage: z.string().nullable().optional(),
});
export type AniListMedia = z.infer<typeof Media>;

const FIELDS = `
  id idMal title { romaji english native } synonyms format episodes seasonYear startDate { year }
  description(asHtml: false) genres averageScore popularity coverImage { extraLarge large } bannerImage
`;

export class AniListError extends Error {
  constructor(
    message: string,
    public readonly status: number | null = null,
  ) {
    super(message);
  }
}

export interface AniListOptions {
  /** Minimum gap between requests. AniList's limit is 30 a minute while it runs degraded. */
  minIntervalMs?: number;
  /** How many times a 429 is waited out and retried before giving up. */
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class AniListClient {
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private lastRequestAt = 0;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly fetcher: Fetcher = (url, init) => fetch(url, init),
    options: AniListOptions = {},
  ) {
    this.minIntervalMs = options.minIntervalMs ?? 2_100;
    this.maxRetries = options.maxRetries ?? 2;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Runs requests one at a time with a minimum gap, so a library scan never trips the limit. */
  private paced<T>(run: () => Promise<T>): Promise<T> {
    const next = this.chain.then(async () => {
      const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.lastRequestAt = Date.now();
      return run();
    });
    this.chain = next.catch(() => undefined);
    return next;
  }

  private query<T>(
    query: string,
    variables: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    return this.paced(() => this.queryOnce(query, variables, schema, 0));
  }

  private async queryOnce<T>(
    query: string,
    variables: Record<string, unknown>,
    schema: z.ZodType<T>,
    attempt: number,
  ): Promise<T> {
    const res = await this.fetcher(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 429) {
      if (attempt >= this.maxRetries) throw new AniListError('AniList rate limit hit', 429);
      // AniList says how long to wait; a minute is the documented window when it does not.
      const retryAfter = Number(res.headers.get('retry-after'));
      await this.sleep((Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60) * 1000);
      this.lastRequestAt = Date.now();
      return this.queryOnce(query, variables, schema, attempt + 1);
    }
    if (!res.ok) throw new AniListError(`AniList request failed with ${res.status}`, res.status);
    const body = (await res.json()) as { data?: unknown; errors?: Array<{ message: string }> };
    if (body.errors?.length) throw new AniListError(body.errors.map((e) => e.message).join('; '));
    const parsed = schema.safeParse(body.data);
    if (!parsed.success) throw new AniListError('AniList returned an unexpected shape');
    return parsed.data;
  }

  async search(title: string): Promise<AniListMedia[]> {
    const data = await this.query(
      `query ($search: String) { Page(perPage: 10) { media(search: $search, type: ANIME, sort: SEARCH_MATCH) { ${FIELDS} } } }`,
      { search: title },
      z.object({ Page: z.object({ media: Media.array() }) }),
    );
    return data.Page.media;
  }

  async get(id: number): Promise<AniListMedia> {
    const data = await this.query(
      `query ($id: Int) { Media(id: $id, type: ANIME) { ${FIELDS} } }`,
      { id },
      z.object({ Media }),
    );
    return data.Media;
  }
}

/** AniList descriptions carry light HTML: <br>, <i>, <b>, and a few entities. */
export function stripHtml(text: string | null | undefined): string | null {
  if (!text) return null;
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Titles to search and score against, best first, without duplicates or nulls. */
export function mediaTitles(media: AniListMedia): string[] {
  return [
    ...new Set(
      [media.title.english, media.title.romaji, media.title.native, ...media.synonyms].filter(
        (t): t is string => !!t,
      ),
    ),
  ];
}
