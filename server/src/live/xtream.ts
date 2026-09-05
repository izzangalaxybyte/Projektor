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

export type XtreamAccount = z.infer<typeof UserInfo>['user_info'];
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
    const info = await this.getJson(this.apiUrl(), UserInfo);
    if (info.user_info.auth !== 1)
      throw new XtreamError('Provider rejected the username or password', 'auth');
    return info.user_info;
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
  /** Catch-up: start time as YYYY-MM-DD:HH-MM in the provider's timezone, duration in minutes. */
  timeshiftUrl(streamId: string, start: Date, durationMinutes: number): string {
    const p = (n: number) => String(n).padStart(2, '0');
    const stamp = `${start.getUTCFullYear()}-${p(start.getUTCMonth() + 1)}-${p(start.getUTCDate())}:${p(start.getUTCHours())}-${p(start.getUTCMinutes())}`;
    return `${this.base}/timeshift/${enc(this.creds.username)}/${enc(this.creds.password)}/${durationMinutes}/${stamp}/${streamId}.ts`;
  }
}

const enc = encodeURIComponent;

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
