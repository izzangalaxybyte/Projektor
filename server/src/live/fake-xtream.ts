// In-memory Xtream Codes provider for tests. Route the app's fetch through `fakeXtream(...).fetch`.
import type { Fetcher } from './xtream.js';

export interface FakeXtreamOptions {
  base?: string;
  username?: string;
  password?: string;
  status?: string;
  expiresAtUnix?: number;
}

export function fakeXtream(opts: FakeXtreamOptions = {}) {
  const base = (opts.base ?? 'http://iptv.test:8080').replace(/\/+$/, '');
  const username = opts.username ?? 'alice';
  const password = opts.password ?? 'secret';
  const calls: string[] = [];
  const state = {
    categories: [
      { category_id: '10', category_name: 'Sports', parent_id: 0 },
      { category_id: '20', category_name: 'News', parent_id: 0 },
    ],
    streams: [
      {
        num: 1,
        name: 'Sport One HD',
        stream_id: 1001,
        stream_icon: 'http://logo.test/1.png',
        epg_channel_id: 'sport1.uk',
        category_id: '10',
        tv_archive: 1,
        tv_archive_duration: 3,
      },
      {
        num: 2,
        name: 'News 24',
        stream_id: 1002,
        stream_icon: '',
        epg_channel_id: 'news24.uk',
        category_id: '20',
        tv_archive: 0,
        tv_archive_duration: 0,
      },
      {
        num: 3,
        name: 'Silent Channel',
        stream_id: 1003,
        stream_icon: null,
        epg_channel_id: '',
        category_id: '20',
        tv_archive: 0,
      },
    ] as Array<Record<string, unknown>>,
    /** Programmes as XMLTV strings; defaults are built around `now`. */
    xmltv: null as string | null,
  };

  const guide = () => {
    if (state.xmltv) return state.xmltv;
    const now = Date.now();
    const at = (offsetMin: number) => xmltvTime(new Date(now + offsetMin * 60_000));
    return `<?xml version="1.0" encoding="UTF-8"?>
<tv generator-info-name="fake">
  <channel id="sport1.uk"><display-name>Sport One HD</display-name></channel>
  <channel id="news24.uk"><display-name>News 24</display-name></channel>
  <programme start="${at(-90)}" stop="${at(-30)}" channel="sport1.uk"><title lang="en">Earlier Match</title><desc>Already over.</desc></programme>
  <programme start="${at(-30)}" stop="${at(60)}" channel="sport1.uk"><title lang="en">Big Match</title><desc lang="en">Live football.</desc></programme>
  <programme start="${at(60)}" stop="${at(120)}" channel="sport1.uk"><title>Post-match</title></programme>
  <programme start="${at(-10)}" stop="${at(20)}" channel="news24.uk"><title>Headlines</title></programme>
  <programme start="${at(0)}" stop="${at(30)}" channel="other.uk"><title>Unknown Channel Show</title></programme>
</tv>`;
  };

  const fetch: Fetcher = async (input) => {
    const url = new URL(input);
    if (`${url.protocol}//${url.host}` !== base) return new Response('not found', { status: 404 });
    calls.push(
      url.pathname +
        (url.searchParams.get('action') ? `?action=${url.searchParams.get('action')}` : ''),
    );
    const authed =
      url.searchParams.get('username') === username &&
      url.searchParams.get('password') === password;
    if (url.pathname === '/player_api.php') {
      if (!authed) return json({ user_info: { auth: 0 } });
      switch (url.searchParams.get('action')) {
        case null:
          return json({
            user_info: {
              auth: 1,
              status: opts.status ?? 'Active',
              exp_date: String(opts.expiresAtUnix ?? 4102444800),
              max_connections: '2',
            },
            server_info: { url: url.hostname, port: url.port, timezone: 'UTC' },
          });
        case 'get_live_categories':
          return json(state.categories);
        case 'get_live_streams':
          return json(state.streams);
        default:
          return json([]);
      }
    }
    if (url.pathname === '/xmltv.php') {
      if (!authed) return new Response('', { status: 401 });
      return new Response(guide(), { status: 200, headers: { 'content-type': 'text/xml' } });
    }
    return new Response('not found', { status: 404 });
  };

  return { base, username, password, calls, state, fetch };
}

export function xmltvTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())} +0000`;
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
