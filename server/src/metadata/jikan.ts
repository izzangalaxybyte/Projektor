// MyAnimeList scores through Jikan (api.jikan.moe), the unofficial MAL API: no key needed, but
// limited to 3 requests a second and 60 a minute, so requests run one at a time with a gap.
import { z } from 'zod';
import type { Fetcher } from './anilist.js';

const ENDPOINT = 'https://api.jikan.moe/v4';

const Anime = z.object({
  data: z.object({
    mal_id: z.number(),
    score: z.number().nullable().optional(),
    scored_by: z.number().nullable().optional(),
    members: z.number().nullable().optional(),
    rating: z.string().nullable().optional(),
  }),
});

export interface MalAnime {
  malId: number;
  /** Out of ten; null until enough users have scored it. */
  score: number | null;
  /** "PG-13", "R - 17+", "R+", ... without the explanation MAL appends. */
  ageRating: string | null;
}

export interface JikanOptions {
  minIntervalMs?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class JikanClient {
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private lastRequestAt = 0;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly fetcher: Fetcher = (url, init) => fetch(url, init),
    options: JikanOptions = {},
  ) {
    this.minIntervalMs = options.minIntervalMs ?? 1_100;
    this.maxRetries = options.maxRetries ?? 3;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** The MAL entry, or null when MAL has no such id. */
  anime(malId: number): Promise<MalAnime | null> {
    const next = this.chain.then(async () => {
      const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.lastRequestAt = Date.now();
      return this.fetchOnce(malId, 0);
    });
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async fetchOnce(malId: number, attempt: number): Promise<MalAnime | null> {
    const res = await this.fetcher(`${ENDPOINT}/anime/${malId}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) return null;
    // 429 for the rate limit, and Jikan answers 5xx while MAL itself is slow: wait and retry.
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= this.maxRetries) throw new Error(`Jikan request failed with ${res.status}`);
      await this.sleep(4_000 * (attempt + 1));
      this.lastRequestAt = Date.now();
      return this.fetchOnce(malId, attempt + 1);
    }
    if (!res.ok) throw new Error(`Jikan request failed with ${res.status}`);
    const parsed = Anime.safeParse(await res.json());
    if (!parsed.success) throw new Error('Jikan returned an unexpected shape');
    const a = parsed.data.data;
    return {
      malId: a.mal_id,
      score: a.score ?? null,
      ageRating: a.rating ? a.rating.split(' - ')[0]!.trim() || null : null,
    };
  }
}
