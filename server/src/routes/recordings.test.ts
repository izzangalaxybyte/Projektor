import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { fakeXtream, ffmpegLoopSource } from '../live/fake-xtream.js';
import { openDatabase, schema } from '../db/index.js';
import { fixturesDir, makeTestConfig, setupAdmin } from '../test-utils.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SAMPLE = path.join(fixturesDir(), 'movies', 'Sample Movie (2019)', 'Sample Movie (2019).mp4');

describe('recordings', () => {
  let cfg: ReturnType<typeof makeTestConfig>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token: string;
  let base: string;
  let provider: ReturnType<typeof fakeXtream>;
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

  const start = async (liveSource?: ReturnType<typeof ffmpegLoopSource>) => {
    cfg = makeTestConfig();
    provider = fakeXtream(liveSource ? { liveSource } : {});
    app = await buildApp({
      config: cfg.config,
      fetch: provider.fetch,
      liveGraceMs: 100,
      recordingTickMs: 100,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    token = (await setupAdmin(app)).token;
    await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: auth(),
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
  const waitState = async (id: string, state: string, timeoutMs = 10_000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const rec = (
        await app.inject({ method: 'GET', url: `/api/recordings/${id}`, headers: auth() })
      ).json();
      if (rec.state === state) return rec;
      if (Date.now() > deadline)
        throw new Error(`still ${rec.state}, wanted ${state}: ${rec.error ?? ''}`);
      await sleep(100);
    }
  };

  describe('with the synthetic provider', () => {
    beforeEach(() => start());

    it('records now for a set time, keeps a file and a sidecar, and lists it under Recordings', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/recordings',
        headers: auth(),
        payload: { channelId: '1001', durationMinutes: 1 },
      });
      expect(created.statusCode).toBe(201);
      const rec = created.json();
      expect(rec).toMatchObject({
        channelName: 'Sport One HD',
        title: 'Big Match',
        programmeId: null,
      });
      expect(['scheduled', 'recording']).toContain(rec.state);
      const running = await waitState(rec.id, 'recording');
      expect(running.actualStartAt).toBeTruthy();
      await sleep(600);
      expect(app.recorder.bytesOf(rec.id)).toBeGreaterThan(188 * 50);
      // The file is served with ranges while it grows.
      const head = await fetch(`${base}/api/recordings/${rec.id}/stream?access_token=${token}`, {
        method: 'HEAD',
      });
      expect(head.status).toBe(200);
      expect(head.headers.get('content-type')).toBe('video/mp2t');
      expect(Number(head.headers.get('content-length'))).toBeGreaterThan(0);
      const part = await fetch(`${base}/api/recordings/${rec.id}/stream?access_token=${token}`, {
        headers: { range: 'bytes=0-187' },
      });
      expect(part.status).toBe(206);
      const bytes = new Uint8Array(await part.arrayBuffer());
      expect(bytes.length).toBe(188);
      expect(bytes[0]).toBe(0x47);

      // Stop by hand: done, with what was captured.
      const stopped = await app.inject({
        method: 'POST',
        url: `/api/recordings/${rec.id}/stop`,
        headers: auth(),
      });
      expect(stopped.json()).toMatchObject({ state: 'done', error: null });
      expect(stopped.json().sizeBytes).toBeGreaterThan(188 * 50);
      const filePath = app.recorder.filePath(rec.id)!;
      expect(filePath.startsWith(cfg.config.recordingsDir)).toBe(true);
      expect(path.basename(path.dirname(filePath))).toBe('Sport One HD');
      expect(existsSync(filePath)).toBe(true);
      const sidecar = JSON.parse(readFileSync(filePath.replace(/\.ts$/, '.json'), 'utf8'));
      expect(sidecar).toMatchObject({
        id: rec.id,
        state: 'done',
        channelId: '1001',
        title: 'Big Match',
      });
      await sleep(250);
      expect(provider.live.open).toBe(0); // the relay closed once nobody needed it

      const list = await app.inject({ method: 'GET', url: '/api/recordings', headers: auth() });
      expect(list.json().map((r: { id: string }) => r.id)).toEqual([rec.id]);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/recordings?state=recording',
            headers: auth(),
          })
        ).json(),
      ).toEqual([]);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/recordings/${rec.id}/stop`,
            headers: auth(),
          })
        ).statusCode,
      ).toBe(409);

      const del = await app.inject({
        method: 'DELETE',
        url: `/api/recordings/${rec.id}`,
        headers: auth(),
      });
      expect(del.statusCode).toBe(204);
      expect(existsSync(filePath)).toBe(false);
      expect(
        (await app.inject({ method: 'GET', url: `/api/recordings/${rec.id}`, headers: auth() }))
          .statusCode,
      ).toBe(404);
    });

    it('stops on its own at the planned end', async () => {
      const startAt = new Date(Date.now() + 300).toISOString();
      const created = await app.inject({
        method: 'POST',
        url: '/api/recordings',
        headers: auth(),
        payload: { channelId: '1002', startAt, title: 'Short one' },
      });
      const rec = created.json();
      expect(rec.state).toBe('scheduled');
      expect(rec.endAt).toBeNull();
      // Give it an end 1.2 s after start by editing the row (the API has no minute fractions).
      const db = openDatabase(cfg.config.dbPath);
      const { eq } = await import('drizzle-orm');
      db.db
        .update(schema.recordings)
        .set({ endAt: new Date(Date.now() + 1500).toISOString() })
        .where(eq(schema.recordings.id, rec.id))
        .run();
      db.sqlite.close();
      await waitState(rec.id, 'recording', 5_000);
      const done = await waitState(rec.id, 'done', 5_000);
      expect(done.sizeBytes).toBeGreaterThan(0);
      expect(done.title).toBe('Short one');
    });

    it('records a guide programme until its end plus padding, and rejects finished ones', async () => {
      const guide = (
        await app.inject({ method: 'GET', url: '/api/live/guide?channel=1001', headers: auth() })
      ).json() as Array<{ id: string; title: string; endAt: string }>;
      const onAir = guide.find((p) => p.title === 'Big Match')!;
      const earlier = guide.find((p) => p.title === 'Earlier Match')!;
      const created = await app.inject({
        method: 'POST',
        url: '/api/recordings',
        headers: auth(),
        payload: { channelId: '1001', programmeId: onAir.id, paddingMs: 60_000 },
      });
      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({
        title: 'Big Match',
        programmeId: onAir.id,
        description: 'Live football.',
      });
      expect(new Date(created.json().endAt).getTime()).toBe(
        new Date(onAir.endAt).getTime() + 60_000,
      );
      await waitState(created.json().id, 'recording');
      const upcoming = guide.find((p) => p.title === 'Post-match')!;
      const later = await app.inject({
        method: 'POST',
        url: '/api/recordings',
        headers: auth(),
        payload: { channelId: '1001', programmeId: upcoming.id },
      });
      expect(later.json().state).toBe('scheduled');
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/recordings',
            headers: auth(),
            payload: { channelId: '1001', programmeId: earlier.id },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/recordings',
            headers: auth(),
            payload: { channelId: '1002', programmeId: onAir.id },
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/recordings',
            headers: auth(),
            payload: { channelId: '9' },
          })
        ).statusCode,
      ).toBe(404);
      // Cancelling a scheduled one removes it.
      const cancel = await app.inject({
        method: 'POST',
        url: `/api/recordings/${later.json().id}/stop`,
        headers: auth(),
      });
      expect(cancel.statusCode).toBe(200);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/api/recordings/${later.json().id}`,
            headers: auth(),
          })
        ).statusCode,
      ).toBe(404);
      await app.recorder.remove(created.json().id);
    });

    it('marks a recording cut off by a restart as failed and keeps the file', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/recordings',
        headers: auth(),
        payload: { channelId: '1001' },
      });
      const id = created.json().id;
      await waitState(id, 'recording');
      await sleep(400);
      const filePath = app.recorder.filePath(id)!;
      await app.close(); // the row stays 'recording', as after a crash
      app = await buildApp({
        config: cfg.config,
        fetch: provider.fetch,
        liveGraceMs: 100,
        recordingTickMs: 100,
      });
      await app.ready();
      const rec = app.recorder.get(id)!;
      expect(rec.state).toBe('failed');
      expect(rec.error).toMatch(/restarted/);
      expect(rec.sizeBytes).toBeGreaterThan(0);
      expect(existsSync(filePath)).toBe(true);
    });
  });

  describe('with an ffmpeg-generated channel', () => {
    beforeEach(() => start(ffmpegLoopSource(makeTestConfig().config.ffmpegPath, SAMPLE)));

    it(
      'produces a playable file with a measured duration, playable direct or as HLS',
      { timeout: 60_000 },
      async () => {
        const created = await app.inject({
          method: 'POST',
          url: '/api/recordings',
          headers: auth(),
          payload: { channelId: '1001' },
        });
        const id = created.json().id;
        await waitState(id, 'recording');
        await sleep(4_000);
        const stopped = await app.inject({
          method: 'POST',
          url: `/api/recordings/${id}/stop`,
          headers: auth(),
        });
        expect(stopped.json().state).toBe('done');
        expect(stopped.json().durationMs).toBeGreaterThan(2_000);
        const filePath = app.recorder.filePath(id)!;
        const probe = await execa(cfg.config.ffprobePath, [
          '-v',
          'error',
          '-show_entries',
          'stream=codec_name',
          '-of',
          'csv=p=0',
          filePath,
        ]);
        expect(probe.stdout).toContain('h264');

        let res = await app.inject({
          method: 'POST',
          url: '/api/live/decide',
          headers: auth(),
          payload: { recordingId: id, profile: profile(['ts']) },
        });
        expect(res.json()).toMatchObject({
          method: 'direct',
          kind: 'recording',
          url: `/api/recordings/${id}/stream`,
          title: 'Big Match',
        });
        res = await app.inject({
          method: 'POST',
          url: '/api/live/decide',
          headers: auth(),
          payload: { recordingId: id, profile: profile(['mp4']) },
        });
        expect(res.json()).toMatchObject({ method: 'hls', kind: 'recording' });
        const { sessionId, url } = res.json();
        const playlist = await app.inject({ method: 'GET', url: `${url}?access_token=${token}` });
        expect(playlist.statusCode).toBe(200);
        expect(playlist.body).toContain('#EXTINF');
        await app.liveHls.stop(sessionId);
      },
    );
  });
});
