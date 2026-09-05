// In-memory Xtream Codes provider for tests. Route the app's fetch through `fakeXtream(...).fetch`.
import { execa } from 'execa';
import { Readable } from 'node:stream';
import type { Fetcher } from './xtream.js';

export interface FakeXtreamOptions {
  base?: string;
  username?: string;
  password?: string;
  status?: string;
  expiresAtUnix?: number;
  /** Bytes for /live/{u}/{p}/{id}.ts; defaults to synthetic TS packets forever. */
  liveSource?: (streamId: string, signal: AbortSignal) => ReadableStream<Uint8Array>;
  /** Bytes for /timeshift/…; defaults to a short finite burst of synthetic TS packets. */
  catchupSource?: (streamId: string, signal: AbortSignal) => ReadableStream<Uint8Array>;
}

export function fakeXtream(opts: FakeXtreamOptions = {}) {
  const base = (opts.base ?? 'http://iptv.test:8080').replace(/\/+$/, '');
  const username = opts.username ?? 'alice';
  const password = opts.password ?? 'secret';
  const calls: string[] = [];
  /** Open provider stream connections, so tests can see a relay drop. */
  const live = { open: 0, opened: 0 };
  /** Every catch-up request: stream id, duration in minutes, start stamp as the provider saw it. */
  const timeshiftCalls: Array<{ streamId: string; duration: number; start: string }> = [];
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

  const fetch: Fetcher = async (input, init) => {
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
    const stream = /^\/live\/([^/]+)\/([^/]+)\/(\d+)\.ts$/.exec(url.pathname);
    if (stream) {
      if (
        decodeURIComponent(stream[1]!) !== username ||
        decodeURIComponent(stream[2]!) !== password
      )
        return new Response('', { status: 401 });
      if (!state.streams.some((s) => String(s['stream_id']) === stream[3]))
        return new Response('', { status: 404 });
      const signal = init?.signal ?? new AbortController().signal;
      live.open += 1;
      live.opened += 1;
      let closed = false;
      const onClose = () => {
        if (closed) return;
        closed = true;
        live.open -= 1;
      };
      signal.addEventListener('abort', onClose, { once: true });
      const source = (opts.liveSource ?? syntheticTs)(stream[3]!, signal);
      const counted = source.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          flush: onClose,
          transform: (c, ctl) => ctl.enqueue(c),
        }),
      );
      return new Response(counted, { status: 200, headers: { 'content-type': 'video/mp2t' } });
    }
    const shift = /^\/timeshift\/([^/]+)\/([^/]+)\/(\d+)\/([^/]+)\/(\d+)\.ts$/.exec(url.pathname);
    if (shift) {
      if (decodeURIComponent(shift[1]!) !== username || decodeURIComponent(shift[2]!) !== password)
        return new Response('', { status: 401 });
      const streamId = shift[5]!;
      if (!state.streams.some((s) => String(s['stream_id']) === streamId))
        return new Response('', { status: 404 });
      timeshiftCalls.push({ streamId, duration: Number(shift[3]), start: shift[4]! });
      const signal = init?.signal ?? new AbortController().signal;
      const source = (opts.catchupSource ?? finiteSyntheticTs)(streamId, signal);
      return new Response(source, { status: 200, headers: { 'content-type': 'video/mp2t' } });
    }
    if (url.pathname === '/xmltv.php') {
      if (!authed) return new Response('', { status: 401 });
      return new Response(guide(), { status: 200, headers: { 'content-type': 'text/xml' } });
    }
    return new Response('not found', { status: 404 });
  };

  return { base, username, password, calls, state, live, timeshiftCalls, fetch };
}

/** A finite burst of synthetic TS packets, the shape of a catch-up download. */
export function finiteSyntheticTs(
  _streamId: string,
  _signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(188 * 200);
  for (let i = 0; i < 200; i++) {
    chunk[i * 188] = 0x47;
    chunk[i * 188 + 1] = 0x01;
    chunk[i * 188 + 3] = 0x10 | (i & 0x0f);
    chunk.fill(0xff, i * 188 + 4, (i + 1) * 188);
  }
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(chunk);
      controller.close();
    },
  });
}

/** Endless 188-byte MPEG-TS packets (sync byte, PID 0x100, rolling counter), 20 per 25 ms. */
export function syntheticTs(_streamId: string, signal: AbortSignal): ReadableStream<Uint8Array> {
  let counter = 0;
  let timer: NodeJS.Timeout | null = null;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const tick = () => {
        if (signal.aborted) {
          controller.close();
          return;
        }
        const chunk = new Uint8Array(188 * 20);
        for (let i = 0; i < 20; i++) {
          chunk[i * 188] = 0x47;
          chunk[i * 188 + 1] = 0x01;
          chunk[i * 188 + 2] = 0x00;
          chunk[i * 188 + 3] = 0x10 | (counter++ & 0x0f);
          chunk.fill(0xff, i * 188 + 4, (i + 1) * 188);
        }
        controller.enqueue(chunk);
        timer = setTimeout(tick, 25);
      };
      tick();
      signal.addEventListener(
        'abort',
        () => {
          if (timer) clearTimeout(timer);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        },
        { once: true },
      );
    },
    cancel() {
      if (timer) clearTimeout(timer);
    },
  });
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

/** A real-time MPEG-TS loop of a video file, the way a provider sends a channel. */
export function ffmpegLoopSource(ffmpegPath: string, file: string) {
  return (_id: string, signal: AbortSignal): ReadableStream<Uint8Array> => {
    const child = execa(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-re',
        '-stream_loop',
        '-1',
        '-i',
        file,
        // Broadcast-style 2 s GOP so the packager can cut 4 s segments; the fixtures have 10 s GOPs.
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-tune',
        'zerolatency',
        '-g',
        '48',
        '-keyint_min',
        '48',
        '-sc_threshold',
        '0',
        '-c:a',
        'copy',
        '-f',
        'mpegts',
        'pipe:1',
      ],
      { reject: false, stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' },
    );
    signal.addEventListener('abort', () => child.kill('SIGKILL'), { once: true });
    return Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>;
  };
}

/** The whole file once, as fast as the reader takes it, the way a provider serves catch-up. */
export function ffmpegFileSource(ffmpegPath: string, file: string) {
  return (_id: string, signal: AbortSignal): ReadableStream<Uint8Array> => {
    const child = execa(
      ffmpegPath,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        file,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-g',
        '48',
        '-keyint_min',
        '48',
        '-sc_threshold',
        '0',
        '-c:a',
        'copy',
        '-f',
        'mpegts',
        'pipe:1',
      ],
      { reject: false, stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' },
    );
    signal.addEventListener('abort', () => child.kill('SIGKILL'), { once: true });
    return Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>;
  };
}
