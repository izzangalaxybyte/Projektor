import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { fixturesDir, makeTestConfig, scanAndWait, setupAdmin } from '../test-utils.js';

const fixtures = fixturesDir();
const t = makeTestConfig();
let app: FastifyInstance;
let headers: Record<string, string>;
let hevcFileId: string | undefined;

const chrome = {
  name: 'Chrome',
  containers: ['mp4', 'webm'],
  videoCodecs: ['h264', 'vp9'],
  audioCodecs: ['aac', 'opus'],
  maxWidth: null,
  maxBitrate: null,
  hlsSegmentContainer: 'fmp4',
};

// HARDWARE_ACCEL=vaapi forces the GPU pipeline without the self-test. This machine (a Mac in
// development, or any box whose driver rejects the source) has no working VAAPI, so the first two
// attempts die before writing a segment and the manager must end up on the software path.
beforeAll(async () => {
  app = await buildApp({ config: { ...t.config, hardwareAccel: 'vaapi' }, hlsWaitMs: 60_000 });
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
    const hevc = detail.files.find((f) => f.fileName.includes('H265'));
    if (hevc) hevcFileId = hevc.id;
  }
});
afterAll(async () => {
  await app.close();
  t.cleanup();
});

describe.skipIf(!existsSync(fixtures))('transcode pipeline fallback', () => {
  it(
    'falls back from vaapi to vaapi-encode to software when ffmpeg fails before a segment',
    { timeout: 90_000 },
    async () => {
      expect(app.hls.hardware).toBe('vaapi');
      const res = await app.inject({
        method: 'POST',
        url: '/api/playback/decide',
        headers,
        payload: { fileId: hevcFileId, profile: chrome },
      });
      const body = res.json() as { method: string; sessionId: string };
      expect(body.method).toBe('transcode');
      const playlist = await app.inject({
        method: 'GET',
        url: `/api/playback/sessions/${body.sessionId}/index.m3u8`,
        headers,
      });
      expect(playlist.statusCode).toBe(200);
      const seg = await app.inject({
        method: 'GET',
        url: `/api/playback/sessions/${body.sessionId}/seg-0.m4s`,
        headers,
      });
      expect(seg.statusCode).toBe(200);
      expect(seg.rawPayload.length).toBeGreaterThan(1000);
      // vaapi, then vaapi-encode, then software: three starts for one session.
      expect(app.hls.startCount(body.sessionId)).toBe(3);
      await app.hls.stop(body.sessionId);
    },
  );
});
