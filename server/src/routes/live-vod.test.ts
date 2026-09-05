import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { fakeXtream, syntheticFile } from '../live/fake-xtream.js';
import { fakeTmdbFetch } from '../metadata/fake-tmdb.js';
import { makeTestConfig, setupAdmin } from '../test-utils.js';

describe('IPTV movies and series', () => {
  let cfg: ReturnType<typeof makeTestConfig>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token: string;
  let base: string;
  const provider = fakeXtream();
  const tmdb = fakeTmdbFetch({
    movies: [{ id: 103, title: 'Sample Movie', year: 2019, runtime: 95 }],
    shows: [
      {
        id: 201,
        name: 'Sample Show',
        year: 2018,
        seasons: [{ number: 1, episodes: [{ number: 1, name: 'Pilot' }] }],
      },
    ],
  });
  const routed = (url: string, init?: RequestInit) =>
    new URL(url).host === new URL(provider.base).host ? provider.fetch(url, init) : tmdb(url, init);
  const auth = () => ({ authorization: `Bearer ${token}` });
  const profile = (containers: string[]) => ({
    name: 't',
    containers,
    videoCodecs: ['h264'],
    audioCodecs: ['aac'],
    maxWidth: null,
    maxBitrate: null,
    hlsSegmentContainer: 'ts',
  });

  beforeEach(async () => {
    cfg = makeTestConfig();
    app = await buildApp({ config: cfg.config, fetch: routed });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    token = (await setupAdmin(app)).token;
    await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: auth(),
      payload: {
        tmdbApiKey: 'good-key',
        iptvUrl: provider.base,
        iptvUsername: provider.username,
        iptvPassword: provider.password,
      },
    });
    await app.live.refresh();
    await app.iptvMatcher.matchPending();
  });
  afterEach(async () => {
    await app.close();
    cfg.cleanup();
  });

  it('lists movies matched against TMDB, with the unmatched one flagged for review', async () => {
    const status = await app.inject({ method: 'GET', url: '/api/live/status', headers: auth() });
    expect(status.json()).toMatchObject({ movies: 2, series: 1, matching: false });

    const cats = await app.inject({
      method: 'GET',
      url: '/api/live/vod/categories',
      headers: auth(),
    });
    expect(cats.json()).toEqual([{ id: 'vod:30', name: 'Movies EN', kind: 'vod' }]);

    const page = await app.inject({ method: 'GET', url: '/api/live/vod', headers: auth() });
    expect(page.json().total).toBe(2);
    const [obscure, sample] = page.json().items;
    expect(obscure).toMatchObject({
      id: '5002',
      title: 'Obscure Film',
      year: 1999,
      needsReview: true,
      posterKey: null,
      tmdbId: null,
      containerExtension: 'mkv',
      logoUrl: null,
    });
    expect(sample).toMatchObject({
      id: '5001',
      title: 'Sample Movie',
      year: 2019,
      needsReview: false,
      tmdbId: 103,
      runtimeMs: 95 * 60_000,
      categoryId: 'vod:30',
      logoUrl: 'http://logo.test/m5001.jpg',
    });
    expect(sample.posterKey).toBeTruthy();
    expect(sample.overview).toContain('Sample Movie');
    const image = await app.inject({
      method: 'GET',
      url: `/api/images/${sample.posterKey}?w=300`,
      headers: auth(),
    });
    expect(image.statusCode).toBe(200);

    const search = await app.inject({
      method: 'GET',
      url: '/api/live/vod?search=obscure',
      headers: auth(),
    });
    expect(search.json().items.map((m: { id: string }) => m.id)).toEqual(['5002']);
    const byCat = await app.inject({
      method: 'GET',
      url: '/api/live/vod?category=vod:30&limit=1&offset=1',
      headers: auth(),
    });
    expect(byCat.json()).toMatchObject({ total: 2, offset: 1 });
    expect(byCat.json().items).toHaveLength(1);
    expect(
      (await app.inject({ method: 'GET', url: '/api/live/vod/5001', headers: auth() })).json(),
    ).toMatchObject({ title: 'Sample Movie' });
    expect(
      (await app.inject({ method: 'GET', url: '/api/live/vod/9', headers: auth() })).statusCode,
    ).toBe(404);
  });

  it('lists series and fetches episodes on first open', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/live/series', headers: auth() });
    expect(list.json().items[0]).toMatchObject({
      id: '7001',
      title: 'Sample Show',
      year: 2018,
      tmdbId: 201,
      needsReview: false,
      categoryId: 'series:40',
    });
    const before = provider.calls.filter((c) => c.includes('get_series_info')).length;
    const detail = await app.inject({
      method: 'GET',
      url: '/api/live/series/7001',
      headers: auth(),
    });
    expect(detail.json().seasons).toEqual([
      {
        number: 1,
        episodes: [
          expect.objectContaining({
            id: '70011',
            episodeNumber: 1,
            title: 'Pilot',
            durationMs: 30_000,
            overview: 'It begins.',
            containerExtension: 'mp4',
          }),
          expect.objectContaining({ id: '70012', episodeNumber: 2, title: 'Second' }),
        ],
      },
      {
        number: 2,
        episodes: [
          expect.objectContaining({
            id: '70021',
            title: 'Return',
            containerExtension: 'mkv',
            durationMs: null,
          }),
        ],
      },
    ]);
    await app.inject({ method: 'GET', url: '/api/live/series/7001', headers: auth() });
    expect(provider.calls.filter((c) => c.includes('get_series_info')).length).toBe(before + 1); // cached
    expect(
      (await app.inject({ method: 'GET', url: '/api/live/series/9', headers: auth() })).statusCode,
    ).toBe(404);
  });

  it('decides direct pass-through or HLS by container, for movies and episodes', async () => {
    let res = await app.inject({
      method: 'POST',
      url: '/api/live/decide',
      headers: auth(),
      payload: { vodId: '5001', profile: profile(['mp4']) },
    });
    expect(res.json()).toMatchObject({
      method: 'direct',
      url: '/api/live/vod/5001/stream',
      kind: 'vod',
      title: 'Sample Movie',
      durationMs: 95 * 60_000,
      sessionId: null,
    });
    res = await app.inject({
      method: 'POST',
      url: '/api/live/decide',
      headers: auth(),
      payload: { vodId: '5002', profile: profile(['mp4']) },
    });
    expect(res.json()).toMatchObject({ method: 'hls', kind: 'vod', title: 'Obscure Film' });
    expect(res.json().url).toBe(`/api/live/sessions/${res.json().sessionId}/index.m3u8`);
    await app.liveHls.stop(res.json().sessionId);
    await app.inject({ method: 'GET', url: '/api/live/series/7001', headers: auth() });
    res = await app.inject({
      method: 'POST',
      url: '/api/live/decide',
      headers: auth(),
      payload: { episodeId: '70011', profile: profile(['mp4']) },
    });
    expect(res.json()).toMatchObject({
      method: 'direct',
      url: '/api/live/series/episodes/70011/stream',
      title: 'Sample Show · S1 E1 Pilot',
      durationMs: 30_000,
    });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/live/decide',
          headers: auth(),
          payload: { vodId: '9', profile: profile(['mp4']) },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/live/decide',
          headers: auth(),
          payload: { profile: profile(['mp4']) },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('passes the file through with byte ranges', async () => {
    const bytes = syntheticFile(96 * 1024);
    const full = await fetch(`${base}/api/live/vod/5001/stream?access_token=${token}`);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('video/mp4');
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    expect(full.headers.get('content-length')).toBe(String(bytes.length));
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(bytes);

    const part = await fetch(`${base}/api/live/vod/5001/stream?access_token=${token}`, {
      headers: { range: 'bytes=1000-1999' },
    });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 1000-1999/${bytes.length}`);
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(bytes.slice(1000, 2000));
    expect(provider.fileRequests.at(-1)).toMatchObject({
      path: '/movie/alice/secret/5001.mp4',
      range: 'bytes=1000-1999',
    });

    const head = await fetch(`${base}/api/live/vod/5001/stream?access_token=${token}`, {
      method: 'HEAD',
    });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-length')).toBe(String(bytes.length));

    await app.inject({ method: 'GET', url: '/api/live/series/7001', headers: auth() });
    const ep = await fetch(`${base}/api/live/series/episodes/70011/stream?access_token=${token}`, {
      headers: { range: 'bytes=0-9' },
    });
    expect(ep.status).toBe(206);
    expect((await ep.arrayBuffer()).byteLength).toBe(10);
    expect(
      (await app.inject({ method: 'GET', url: '/api/live/vod/9/stream', headers: auth() }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/live/series/episodes/9/stream',
          headers: auth(),
        })
      ).statusCode,
    ).toBe(404);
  });
});
