// Xtream Codes API client: player_api.php for account, categories, and streams; xmltv.php for the guide.
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface XtreamCredentials {
  url: string;
  username: string;
  password: string;
}

// Providers are inconsistent about numbers vs strings; coerce everything we read.
const num = z.coerce.number();
const str = z.coerce.string();

const UserInfo = z.object({
  user_info: z.object({
    auth: num,
    status: str.optional(),
    exp_date: str.nullable().optional(),
    max_connections: str.optional(),
  }),
  server_info: z
    .object({ url: str.optional(), port: str.optional(), timezone: str.optional() })
    .optional(),
});
const Category = z.object({ category_id: str, category_name: str, parent_id: num.optional() });
const LiveStream = z.object({
  num: num.optional(),
  name: str,
  stream_id: num,
  stream_icon: str.nullable().optional(),
  epg_channel_id: str.nullable().optional(),
  category_id: str.nullable().optional(),
  tv_archive: num.optional(),
  tv_archive_duration: num.optional(),
});
const VodStream = z.object({
  num: num.optional(),
  name: str,
  stream_id: num,
  stream_icon: str.nullable().optional(),
  rating: str.nullable().optional(),
  category_id: str.nullable().optional(),
  container_extension: str.optional(),
  added: str.optional(),
});
const Series = z.object({
  num: num.optional(),
  name: str,
  series_id: num,
  cover: str.nullable().optional(),
  plot: str.nullable().optional(),
  releaseDate: str.nullable().optional(),
  rating: str.nullable().optional(),
  category_id: str.nullable().optional(),
});

const VodInfo = z.object({
  info: z
    .object({
      movie_image: str.nullable().optional(),
      plot: str.nullable().optional(),
      duration_secs: num.nullable().optional(),
      releasedate: str.nullable().optional(),
      rating: str.nullable().optional(),
      genre: str.nullable().optional(),
      tmdb_id: str.nullable().optional(),
    })
    .passthrough()
    .optional(),
  movie_data: z
    .object({
      stream_id: num.optional(),
      name: str.optional(),
      container_extension: str.optional(),
    })
    .passthrough()
    .optional(),
});
const SeriesEpisode = z.object({
  id: str,
  episode_num: num,
  title: str.optional(),
  container_extension: str.optional(),
  season: num.optional(),
  info: z
    .object({
      duration_secs: num.nullable().optional(),
      plot: str.nullable().optional(),
      movie_image: str.nullable().optional(),
    })
    .passthrough()
    .optional(),
});
const SeriesInfo = z.object({
  info: z
    .object({ plot: str.nullable().optional(), cover: str.nullable().optional() })
    .passthrough()
    .optional(),
  /** Keyed by season number, or (some providers) an array of arrays. */
  episodes: z
    .union([z.record(z.string(), SeriesEpisode.array()), SeriesEpisode.array().array()])
    .optional(),
});

export type XtreamAccount = z.infer<typeof UserInfo>['user_info'];
export type XtreamVodInfo = z.infer<typeof VodInfo>;
export type XtreamSeriesEpisode = z.infer<typeof SeriesEpisode>;
export type XtreamSeriesInfo = z.infer<typeof SeriesInfo>;
export type XtreamAccountInfo = z.infer<typeof UserInfo>;
export type XtreamCategory = z.infer<typeof Category>;
export type XtreamLiveStream = z.infer<typeof LiveStream>;
export type XtreamVodStream = z.infer<typeof VodStream>;
export type XtreamSeries = z.infer<typeof Series>;

export interface GuideProgramme {
  epgChannelId: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
}

export class XtreamError extends Error {
  constructor(
    message: string,
    public readonly kind: 'auth' | 'network' | 'shape',
  ) {
    super(message);
  }
}

export class XtreamClient {
  private readonly base: string;

  constructor(
    private readonly creds: XtreamCredentials,
    private readonly fetcher: Fetcher = (url, init) => fetch(url, init),
  ) {
    this.base = creds.url.trim().replace(/\/+$/, '');
  }

  private apiUrl(action?: string, extra: Record<string, string | number> = {}): string {
    const u = new URL(`${this.base}/player_api.php`);
    u.searchParams.set('username', this.creds.username);
    u.searchParams.set('password', this.creds.password);
    if (action) u.searchParams.set('action', action);
    for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, String(v));
    return u.toString();
  }

  private async getJson<T>(url: string, schema: z.ZodType<T>): Promise<T> {
    let res: Response;
    try {
      res = await this.fetcher(url, {
        signal: AbortSignal.timeout(30_000),
        headers: { accept: 'application/json' },
      });
    } catch (error) {
      throw new XtreamError(
        `Provider unreachable: ${error instanceof Error ? error.message : String(error)}`,
        'network',
      );
    }
    if (!res.ok) throw new XtreamError(`Provider answered ${res.status}`, 'network');
    const body = await res.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      throw new XtreamError('Provider response was not in the expected shape', 'shape');
    return parsed.data;
  }

  /** Checks the credentials. Xtream answers 200 with auth: 0 for a bad login. */
  async account(): Promise<XtreamAccount> {
    return (await this.accountInfo()).user_info;
  }

  /** Account plus server details; `server_info.timezone` is what timeshift URLs are expressed in. */
  async accountInfo(): Promise<XtreamAccountInfo> {
    const info = await this.getJson(this.apiUrl(), UserInfo);
    if (info.user_info.auth !== 1)
      throw new XtreamError('Provider rejected the username or password', 'auth');
    return info;
  }

  liveCategories() {
    return this.getJson(this.apiUrl('get_live_categories'), Category.array());
  }
  liveStreams() {
    return this.getJson(this.apiUrl('get_live_streams'), LiveStream.array());
  }
  vodCategories() {
    return this.getJson(this.apiUrl('get_vod_categories'), Category.array());
  }
  vodStreams() {
    return this.getJson(this.apiUrl('get_vod_streams'), VodStream.array());
  }
  seriesCategories() {
    return this.getJson(this.apiUrl('get_series_categories'), Category.array());
  }
  series() {
    return this.getJson(this.apiUrl('get_series'), Series.array());
  }
  vodInfo(vodId: string) {
    return this.getJson(this.apiUrl('get_vod_info', { vod_id: vodId }), VodInfo);
  }
  seriesInfo(seriesId: string) {
    return this.getJson(this.apiUrl('get_series_info', { series_id: seriesId }), SeriesInfo);
  }

  /** The XMLTV guide. Large; parsed in one go, which is fine for a week of a few hundred channels. */
  async guide(): Promise<GuideProgramme[]> {
    const u = new URL(`${this.base}/xmltv.php`);
    u.searchParams.set('username', this.creds.username);
    u.searchParams.set('password', this.creds.password);
    let res: Response;
    try {
      res = await this.fetcher(u.toString(), { signal: AbortSignal.timeout(120_000) });
    } catch (error) {
      throw new XtreamError(
        `Guide unreachable: ${error instanceof Error ? error.message : String(error)}`,
        'network',
      );
    }
    if (!res.ok) throw new XtreamError(`Guide answered ${res.status}`, 'network');
    return parseXmltv(await res.text());
  }

  /** Stream URLs the relay pulls from. Credentials are in the path, so these never leave the server. */
  liveUrl(streamId: string, ext: 'ts' | 'm3u8' = 'ts'): string {
    return `${this.base}/live/${enc(this.creds.username)}/${enc(this.creds.password)}/${streamId}.${ext}`;
  }
  vodUrl(streamId: string, ext: string): string {
    return `${this.base}/movie/${enc(this.creds.username)}/${enc(this.creds.password)}/${streamId}.${ext}`;
  }
  seriesEpisodeUrl(episodeId: string, ext: string): string {
    return `${this.base}/series/${enc(this.creds.username)}/${enc(this.creds.password)}/${episodeId}.${ext}`;
  }
  /**
   * Catch-up: the programme start as YYYY-MM-DD:HH-MM in the provider's own timezone (from
   * server_info) and its length in minutes.
   */
  timeshiftUrl(
    streamId: string,
    start: Date,
    durationMinutes: number,
    timeZone: string = 'UTC',
  ): string {
    const stamp = formatTimeshiftStart(start, timeZone);
    return `${this.base}/timeshift/${enc(this.creds.username)}/${enc(this.creds.password)}/${durationMinutes}/${stamp}/${streamId}.ts`;
  }
}

const enc = encodeURIComponent;

/** "2026-09-05:18-30" for the instant in the given IANA timezone; falls back to UTC for a bad zone. */
export function formatTimeshiftStart(start: Date, timeZone: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(start);
  } catch {
    return formatTimeshiftStart(start, 'UTC');
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}:${get('hour')}-${get('minute')}`;
}

/** XMLTV timestamps look like "20260905183000 +0000". */
export function parseXmltvTime(value: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*(?:([+-])(\d{2})(\d{2}))?$/.exec(
    value.trim(),
  );
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '00', sign, oh, om] = m;
  let ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  if (sign && oh && om) {
    const offset = (Number(oh) * 60 + Number(om)) * 60_000;
    ms += sign === '+' ? -offset : offset;
  }
  return new Date(ms).toISOString();
}

export function parseXmltv(xml: string): GuideProgramme[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    isArray: (name) => name === 'programme' || name === 'channel',
  });
  const doc = parser.parse(xml) as { tv?: { programme?: Array<Record<string, unknown>> } };
  const out: GuideProgramme[] = [];
  for (const p of doc.tv?.programme ?? []) {
    const startAt = parseXmltvTime(String(p['@_start'] ?? ''));
    const endAt = parseXmltvTime(String(p['@_stop'] ?? ''));
    const channel = String(p['@_channel'] ?? '');
    if (!startAt || !endAt || !channel) continue;
    out.push({
      epgChannelId: channel,
      title: text(p['title']) || 'Untitled',
      description: text(p['desc']) || null,
      startAt,
      endAt,
    });
  }
  return out;
}

function text(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node).trim();
  if (Array.isArray(node)) return text(node[0]);
  if (typeof node === 'object' && '#text' in (node as object))
    return String((node as Record<string, unknown>)['#text'] ?? '').trim();
  return '';
}

/** Flattens a series_info episode map (by season) or array-of-arrays into one list with seasons. */
export function flattenSeriesEpisodes(
  info: XtreamSeriesInfo,
): Array<XtreamSeriesEpisode & { seasonNumber: number }> {
  const out: Array<XtreamSeriesEpisode & { seasonNumber: number }> = [];
  const eps = info.episodes;
  if (!eps) return out;
  if (Array.isArray(eps)) {
    eps.forEach((list, i) =>
      list.forEach((e) => out.push({ ...e, seasonNumber: e.season ?? i + 1 })),
    );
    return out;
  }
  for (const [season, list] of Object.entries(eps)) {
    const n = Number(season);
    for (const e of list)
      out.push({ ...e, seasonNumber: e.season ?? (Number.isFinite(n) ? n : 1) });
  }
  return out;
}

/**
 * Provider names look like "EN - Sample Movie (2019) 4K" or "|FR| Film 1999 MULTI". Strip the
 * language prefix and quality tags, pull the year, and keep the rest as the title to search for.
 */
export function parseProviderTitle(name: string): { title: string; year: number | null } {
  let s = name.trim();
  // "EN - ", "|EN| ", "[EN] ", "EN: " and the like.
  s = s.replace(/^(?:[[|(]\s*[A-Z]{2,3}\s*[\]|)]\s*[-:|]?\s*|[A-Z]{2,3}\s*[-:|]\s*)/, '');
  let year: number | null = null;
  const paren = /\((19|20)\d{2}\)/.exec(s);
  if (paren) {
    year = Number(paren[0].slice(1, 5));
    s = s.slice(0, paren.index) + s.slice(paren.index + paren[0].length);
  } else {
    const trailing = /\b((?:19|20)\d{2})\b(?!.*\b(?:19|20)\d{2}\b)/.exec(s);
    if (trailing && trailing.index > 0) {
      year = Number(trailing[1]);
      s = s.slice(0, trailing.index) + s.slice(trailing.index + trailing[0].length);
    }
  }
  s = s.replace(
    /\b(4k|uhd|fhd|hd|sd|1080p|720p|2160p|hdr|dolby|multi(-?sub)?|dual(-?audio)?|vostfr|vf|latino|dubbed)\b/gi,
    ' ',
  );
  s = s
    .replace(/[[\]()|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\s\-:]+$/, '')
    .trim();
  return { title: s || name.trim(), year };
}
