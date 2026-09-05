import { execa } from 'execa';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { fakeXtream, ffmpegFileSource, ffmpegLoopSource } from '../live/fake-xtream.js';
import { fixturesDir, makeTestConfig, setupAdmin } from '../test-utils.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SAMPLE = path.join(fixturesDir(), 'movies', 'Sample Movie (2019)', 'Sample Movie (2019).mp4');

describe('live streaming routes', () => {
  let cfg: ReturnType<typeof makeTestConfig>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token: string;
  let provider: ReturnType<typeof fakeXtream>;
  let base: string;

  const start = async (
    sources: {
      liveSource?: ReturnType<typeof ffmpegLoopSource>;
      catchupSource?: ReturnType<typeof ffmpegFileSource>;
    } = {},
  ) => {
    cfg = makeTestConfig();
    provider = fakeXtream(sources);
    app = await buildApp({
      config: cfg.config,
      fetch: provider.fetch,
      liveGraceMs: 100,
      hlsWaitMs: 25_000,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    token = (await setupAdmin(app)).token;
    await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        iptvUrl: provider.base,
        iptvUsername: provider.username,
        iptvPassword: provider.password,
      },
    });
    await app.live.refresh();
  };
  afterEach(async () => {
    await app.close();
    cfg.cleanup();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });
  const profile = (containers: string[]) => ({
    name: 'test',
    containers,
    videoCodecs: ['h264'],
    audioCodecs: ['aac'],
    maxWidth: null,
    maxBitrate: null,
    hlsSegmentContainer: 'ts',
  });

  describe('with a synthetic provider stream', () => {
    beforeEach(() => start());

    it('decides direct for TS-capable devices and hls for the rest', async () => {
      let res = await app.inject({
        method: 'POST',
        url: '/api/live/decide',
        headers: auth(),
        payload: { channelId: '1001', profile: profile(['mp4', 'ts']) },
      });
      expect(res.json()).toEqual({
        method: 'direct',
        url: '/api/live/channels/1001/stream',
        sessionId: null,
        reason: 'device plays MPEG-TS',
        kind: 'live',
        durationMs: null,
        title: null,
      });
      res = await app.inject({
        method: 'POST',
        url: '/api/live/decide',
        headers: auth(),
        payload: { channelId: '1001', profile: profile(['mp4']) },
      });
      expect(res.json()).toMatchObject({ method: 'hls', reason: expect.stringContaining('HLS') });
      expect(res.json().url).toBe(`/api/live/sessions/${res.json().sessionId}/index.m3u8`);
      res = await app.inject({
        method: 'POST',
        url: '/api/live/decide',
        headers: auth(),
        payload: { channelId: '9', profile: profile(['ts']) },
      });
      expect(res.statusCode).toBe(404);
    });

    it('relays the provider bytes and drops the provider when the viewer disconnects', async () => {
      const controller = new AbortController();
      const res = await fetch(`${base}/api/live/channels/1001/stream?access_token=${token}`, {
        signal: controller.signal,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('video/mp2t');
      const reader = res.body!.getReader();
      let got = 0;
      let first: Uint8Array | null = null;
      while (got < 188 * 100) {
        const { value, done } = await reader.read();
        if (done) break;
        first ??= value;
        got += value.length;
      }
      expect(first![0]).toBe(0x47);
      expect(provider.live.open).toBe(1);
      expect(app.liveRelays.active()).toBe(1);
      controller.abort();
      await sleep(400);
      expect(provider.live.open).toBe(0);
      expect(app.liveRelays.active()).toBe(0);
    });

    it('answers HEAD without opening a provider connection, and 404 for unknown channels', async () => {
      const head = await fetch(`${base}/api/live/channels/1001/stream?access_token=${token}`, {
        method: 'HEAD',
      });
      expect(head.status).toBe(200);
      expect(head.headers.get('content-type')).toBe('video/mp2t');
      expect(provider.live.opened).toBe(0);
      expect(
        (await app.inject({ method: 'GET', url: '/api/live/channels/9/stream', headers: auth() }))
          .statusCode,
      ).toBe(404);
      expect(
        (await app.inject({ method: 'GET', url: '/api/live/channels/1001/stream' })).statusCode,
      ).toBe(401);
    });

    it('validates catch-up requests', async () => {
      const guide = (
        await app.inject({ method: 'GET', url: '/api/live/guide?channel=1001', headers: auth() })
      ).json() as Array<{ id: string; title: string }>;
      const earlier = guide.find((p) => p.title === 'Earlier Match')!;
      const onAir = guide.find((p) => p.title === 'Big Match')!;
      const decide = (channelId: string, programmeId: string) =>
        app.inject({
          method: 'POST',
          url: '/api/live/decide',
          headers: auth(),
          payload: { channelId, profile: profile(['ts']), programmeId },
        });
      expect((await decide('1001', 'nope')).statusCode).toBe(404);
      expect((await decide('1002', earlier.id)).statusCode).toBe(404); // wrong channel
      let res = await decide('1001', onAir.id);
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/not finished/);
      const news = (
        await app.inject({ method: 'GET', url: '/api/live/guide?channel=1002', headers: auth() })
      ).json() as Array<{ id: string }>;
      res = await decide('1002', news[0]!.id);
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/no catch-up/);
      res = await decide('1001', earlier.id);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        method: 'hls',
        kind: 'catchup',
        title: 'Earlier Match',
        durationMs: 60 * 60_000,
      });
      expect(res.json().sessionId).toBeTruthy();
      await app.liveHls.stop(res.json().sessionId);
    });

    it('returns 502 when the provider refuses the stream', async () => {
      provider.state.streams.push({ num: 9, name: 'Ghost', stream_id: 1999, category_id: '10' });
      await app.live.refresh();
      provider.state.streams = provider.state.streams.filter((s) => s['stream_id'] !== 1999); // provider 404s it
      const res = await app.inject({
        method: 'GET',
        url: '/api/live/channels/1999/stream',
        headers: auth(),
      });
      expect(res.statusCode).toBe(502);
      expect(app.liveRelays.active()).toBe(0);
    });
  });

  describe('with an ffmpeg-generated provider stream', () => {
    beforeEach(() => start({ liveSource: ffmpegLoopSource(cfgFfmpeg(), SAMPLE) }));

    it(
      'packages the channel as a sliding-window HLS playlist with AAC audio',
      { timeout: 60_000 },
      async () => {
        const decide = await app.inject({
          method: 'POST',
          url: '/api/live/decide',
          headers: auth(),
          payload: { channelId: '1001', profile: profile(['mp4']) },
        });
        const { sessionId, url } = decide.json();
        const playlist = await app.inject({ method: 'GET', url: `${url}?access_token=${token}` });
        expect(playlist.statusCode).toBe(200);
        expect(playlist.headers['content-type']).toBe('application/vnd.apple.mpegurl');
        const body = playlist.body;
        expect(body).toContain('#EXTM3U');
        expect(body).not.toContain('#EXT-X-ENDLIST');
        expect(body).not.toContain('#EXT-X-PLAYLIST-TYPE');
        const seg = /^(seg-\d+\.ts)\?access_token=/m.exec(body);
        expect(seg).not.toBeNull();
        const segment = await app.inject({
          method: 'GET',
          url: `/api/live/sessions/${sessionId}/${seg![1]}`,
          headers: auth(),
        });
        expect(segment.statusCode).toBe(200);
        expect(segment.rawPayload[0]).toBe(0x47);
        const probe = await execa(cfg.config.ffprobePath, [
          '-v',
          'error',
          '-show_entries',
          'stream=codec_type,codec_name',
          '-of',
          'csv=p=0',
          path.join(app.liveHls.dir(sessionId), seg![1]!),
        ]);
        expect(probe.stdout).toContain('h264,video');
        expect(probe.stdout).toContain('aac,audio');
        expect(provider.live.open).toBe(1);

        const stop = await app.inject({
          method: 'DELETE',
          url: `/api/live/sessions/${sessionId}`,
          headers: auth(),
        });
        expect(stop.statusCode).toBe(204);
        await sleep(400);
        expect(provider.live.open).toBe(0);
        expect(
          (
            await app.inject({
              method: 'GET',
              url: `/api/live/sessions/${sessionId}/index.m3u8`,
              headers: auth(),
            })
          ).statusCode,
        ).toBe(404);
      },
    );
  });

  describe('catch-up with an ffmpeg-generated programme', () => {
    beforeEach(() =>
      start({
        liveSource: ffmpegLoopSource(cfgFfmpeg(), SAMPLE),
        catchupSource: ffmpegFileSource(cfgFfmpeg(), SAMPLE),
      }),
    );

    it(
      'packages a past programme as a seekable EVENT playlist that ends',
      { timeout: 60_000 },
      async () => {
        const guide = (
          await app.inject({ method: 'GET', url: '/api/live/guide?channel=1001', headers: auth() })
        ).json() as Array<{ id: string; title: string; startAt: string }>;
        const earlier = guide.find((p) => p.title === 'Earlier Match')!;
        const decide = await app.inject({
          method: 'POST',
          url: '/api/live/decide',
          headers: auth(),
          payload: { channelId: '1001', profile: profile(['mp4']), programmeId: earlier.id },
        });
        const { sessionId, url } = decide.json();
        const first = await app.inject({ method: 'GET', url: `${url}?access_token=${token}` });
        expect(first.statusCode).toBe(200);
        expect(first.body).toContain('#EXT-X-PLAYLIST-TYPE:EVENT');
        // The provider saw the programme start in its zone (UTC for the fake) and the length in minutes.
        const start = new Date(earlier.startAt);
        const p = (n: number) => String(n).padStart(2, '0');
        expect(provider.timeshiftCalls).toEqual([
          {
            streamId: '1001',
            duration: 60,
            start: `${start.getUTCFullYear()}-${p(start.getUTCMonth() + 1)}-${p(start.getUTCDate())}:${p(start.getUTCHours())}-${p(start.getUTCMinutes())}`,
          },
        ]);
        // The 30 s sample arrives at full speed, so the playlist soon has every segment and ENDLIST.
        let body = '';
        for (let i = 0; i < 100 && !body.includes('#EXT-X-ENDLIST'); i++) {
          await sleep(300);
          body = (
            await app.inject({
              method: 'GET',
              url: `/api/live/sessions/${sessionId}/index.m3u8`,
              headers: auth(),
            })
          ).body;
        }
        expect(body).toContain('#EXT-X-ENDLIST');
        expect((body.match(/^seg-\d+\.ts$/gm) ?? []).length).toBeGreaterThanOrEqual(3);
        await app.liveHls.stop(sessionId);
      },
    );
  });

  function cfgFfmpeg() {
    return makeTestConfig().config.ffmpegPath;
  }
});
