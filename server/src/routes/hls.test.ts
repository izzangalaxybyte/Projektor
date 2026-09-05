import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { configForDataDir } from '../config.js';
import { fixturesDir, scanAndWait, setupAdmin } from '../test-utils.js';

const fixtures = fixturesDir();
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'projektor-hls-'));
let app: FastifyInstance;
let headers: Record<string, string>;
let mkvId: string;
let mp4Id: string;

const safari = {
  name: 'Safari',
  containers: ['mp4'],
  videoCodecs: ['h264', 'hevc'],
  audioCodecs: ['aac', 'ac3'],
  maxWidth: null,
  maxBitrate: null,
  hlsSegmentContainer: 'fmp4',
};
const tizen = { ...safari, name: 'Tizen', containers: ['mp4', 'ts'], hlsSegmentContainer: 'ts' };

beforeAll(async () => {
  app = await buildApp({
    config: configForDataDir(dataDir, {
      logLevel: 'fatal',
      watchLibraries: false,
      hlsIdleMs: 800,
      hlsSeekAheadSegments: 0,
    }),
  });
  await app.ready();
  headers = { authorization: `Bearer ${(await setupAdmin(app)).token}` };
  if (!existsSync(fixtures)) return;
  const create = await app.inject({
    method: 'POST',
    url: '/api/libraries',
    headers,
    payload: { name: 'All', kind: 'movie', paths: [fixtures] },
  });
  await scanAndWait(app, headers, (create.json() as { id: string }).id);
  const items = (
    await app.inject({ method: 'GET', url: '/api/items?libraryKind=movie', headers })
  ).json() as { items: Array<{ id: string }> };
  for (const item of items.items) {
    const detail = (
      await app.inject({ method: 'GET', url: `/api/items/${item.id}`, headers })
    ).json() as { files: Array<{ id: string; fileName: string }> };
    for (const f of detail.files) {
      if (f.fileName.endsWith('H265-GRP.mkv')) mkvId = f.id;
      if (f.fileName === 'Sample Movie (2019).mp4') mp4Id = f.id;
    }
  }
});
afterAll(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function openSession(fileId: string, profile: unknown) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/playback/decide',
    headers,
    payload: { fileId, profile },
  });
  return res.json() as { method: string; sessionId: string; url: string };
}
const get = (url: string) => app.inject({ method: 'GET', url, headers });

async function waitForEndlist(sessionId: string, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await get(`/api/playback/sessions/${sessionId}/index.m3u8`);
    if (res.statusCode === 200 && res.body.includes('#EXT-X-ENDLIST')) return res.body;
    if (Date.now() > deadline)
      throw new Error(`playlist never finished: ${res.statusCode} ${res.body.slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function probeWidth(file: string): Promise<number> {
  const { stdout } = await execa('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file]);
  const streams = (JSON.parse(stdout) as { streams: Array<{ codec_type: string; width?: number }> })
    .streams;
  return streams.find((s) => s.codec_type === 'video')?.width ?? -1;
}

async function probeSegment(body: Buffer, ext: string, init?: Buffer): Promise<string[]> {
  const file = path.join(dataDir, `probe.${ext}`);
  writeFileSync(file, init ? Buffer.concat([init, body]) : body);
  const { stdout } = await execa('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file]);
  return (JSON.parse(stdout) as { streams: Array<{ codec_name: string }> }).streams.map(
    (s) => s.codec_name,
  );
}

describe.skipIf(!existsSync(fixtures))('HLS remux sessions', () => {
  it('remuxes an mkv into mpegts segments that carry the original codecs', async () => {
    const session = await openSession(mkvId, tizen);
    expect(session.method).toBe('remux');

    const master = await get(session.url);
    expect(master.statusCode).toBe(200);
    expect(master.headers['content-type']).toBe('application/vnd.apple.mpegurl');
    expect(master.body).toContain('#EXT-X-VERSION:3');
    expect(master.body).toContain('index.m3u8');

    const playlist = await waitForEndlist(session.sessionId);
    const durations = [...playlist.matchAll(/#EXTINF:([\d.]+)/g)].map((m) => Number(m[1]));
    const total = durations.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(28);
    expect(total).toBeLessThan(32);
    expect(playlist).toContain('seg-0.ts');

    const seg = await get(`/api/playback/sessions/${session.sessionId}/seg-0.ts`);
    expect(seg.statusCode).toBe(200);
    expect(seg.headers['content-type']).toBe('video/mp2t');
    expect(seg.rawPayload.length).toBeGreaterThan(10_000);
    expect(await probeSegment(seg.rawPayload, 'ts')).toEqual(['hevc', 'ac3']);
  });

  it('remuxes into fmp4 with an init segment', async () => {
    const session = await openSession(mkvId, safari);
    const master = await get(session.url);
    expect(master.body).toContain('#EXT-X-VERSION:7');
    const playlist = await waitForEndlist(session.sessionId);
    expect(playlist).toContain('#EXT-X-MAP:URI="init.mp4"');
    const init = await get(`/api/playback/sessions/${session.sessionId}/init.mp4`);
    expect(init.headers['content-type']).toBe('video/mp4');
    const seg = await get(`/api/playback/sessions/${session.sessionId}/seg-0.m4s`);
    expect(seg.headers['content-type']).toBe('video/iso.segment');
    expect(await probeSegment(seg.rawPayload, 'mp4', init.rawPayload)).toEqual(['hevc', 'ac3']);
  });

  it('transcodes audio during remux when the profile lacks the codec', async () => {
    const session = await openSession(mkvId, { ...tizen, audioCodecs: ['aac'] });
    expect(session.method).toBe('remux');
    await waitForEndlist(session.sessionId);
    const seg = await get(`/api/playback/sessions/${session.sessionId}/seg-0.ts`);
    expect(await probeSegment(seg.rawPayload, 'ts')).toEqual(['hevc', 'aac']);
  });

  it('404s for unknown sessions, bad names, and segments past the end', async () => {
    expect((await get('/api/playback/sessions/nope/master.m3u8')).statusCode).toBe(404);
    const session = await openSession(mkvId, tizen);
    // Fastify collapses a raw '..' into a different route; an encoded one must fail validation.
    expect([400, 404]).toContain(
      (await get(`/api/playback/sessions/${session.sessionId}/..%2Fetc%2Fpasswd`)).statusCode,
    );
    await waitForEndlist(session.sessionId);
    const missing = await get(`/api/playback/sessions/${session.sessionId}/seg-999.ts`);
    expect(missing.statusCode).toBe(404);
  });

  it('DELETE stops the session and removes its directory', async () => {
    const session = await openSession(mkvId, tizen);
    await get(`/api/playback/sessions/${session.sessionId}/index.m3u8`);
    const dir = app.hls.dir(session.sessionId);
    expect(existsSync(dir)).toBe(true);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/playback/sessions/${session.sessionId}`,
          headers,
        })
      ).statusCode,
    ).toBe(204);
    expect(existsSync(dir)).toBe(false);
    expect((await get(`/api/playback/sessions/${session.sessionId}/master.m3u8`)).statusCode).toBe(
      404,
    );
  });

  it('sweeps idle sessions', async () => {
    const session = await openSession(mkvId, tizen);
    await get(`/api/playback/sessions/${session.sessionId}/index.m3u8`);
    const dir = app.hls.dir(session.sessionId);
    await new Promise((r) => setTimeout(r, 2000));
    expect(existsSync(dir)).toBe(false);
    expect(app.playback.get(session.sessionId)).toBeUndefined();
  });

  it('transcodes hevc to h264 with a precomputed VOD playlist and restarts ffmpeg once for a far seek', async () => {
    const session = await openSession(mkvId, {
      ...tizen,
      videoCodecs: ['h264'],
      audioCodecs: ['aac'],
      maxWidth: 480,
    });
    expect(session.method).toBe('transcode');

    const index = await get(`/api/playback/sessions/${session.sessionId}/index.m3u8`);
    expect(index.statusCode).toBe(200);
    expect(index.body).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    const segments = index.body.match(/^seg-\d+\.ts$/gm)!;
    expect(segments).toEqual([
      'seg-0.ts',
      'seg-1.ts',
      'seg-2.ts',
      'seg-3.ts',
      'seg-4.ts',
      'seg-5.ts',
    ]);
    expect(app.hls.startCount(session.sessionId)).toBe(1);

    const first = await get(`/api/playback/sessions/${session.sessionId}/seg-0.ts`);
    expect(first.statusCode).toBe(200);
    expect(await probeSegment(first.rawPayload, 'ts')).toEqual(['h264', 'aac']);
    expect(await probeWidth(path.join(dataDir, 'probe.ts'))).toBe(480);

    // Segment 4 is ahead of where ffmpeg is: expect a restart at 24s and a matching timestamp.
    const last = await get(`/api/playback/sessions/${session.sessionId}/seg-4.ts`);
    expect(last.statusCode).toBe(200);
    expect(app.hls.startCount(session.sessionId)).toBe(2);
    writeFileSync(path.join(dataDir, 'probe-last.ts'), last.rawPayload);
    const start = await execa('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=start_time',
      '-of',
      'csv=p=0',
      path.join(dataDir, 'probe-last.ts'),
    ]);
    expect(Number(start.stdout.trim())).toBeGreaterThan(23);
    expect(Number(start.stdout.trim())).toBeLessThan(25.5);

    // Going back to a segment the first run already wrote does not restart anything.
    expect((await get(`/api/playback/sessions/${session.sessionId}/seg-0.ts`)).statusCode).toBe(
      200,
    );
    expect(app.hls.startCount(session.sessionId)).toBe(2);
    expect((await get(`/api/playback/sessions/${session.sessionId}/seg-9.ts`)).statusCode).toBe(
      404,
    );
    expect(mp4Id).toBeTruthy();
  });

  it('starts a transcode at the requested position', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/playback/decide',
      headers,
      payload: {
        fileId: mkvId,
        profile: { ...tizen, videoCodecs: ['h264'] },
        startPositionMs: 13_000,
      },
    });
    const session = res.json() as { sessionId: string };
    const seg = await get(`/api/playback/sessions/${session.sessionId}/seg-2.ts`);
    expect(seg.statusCode).toBe(200);
    expect(app.hls.startCount(session.sessionId)).toBe(1);
    // Segment 0 is behind the start: one restart.
    expect((await get(`/api/playback/sessions/${session.sessionId}/seg-0.ts`)).statusCode).toBe(
      200,
    );
    expect(app.hls.startCount(session.sessionId)).toBe(2);
  });
});
