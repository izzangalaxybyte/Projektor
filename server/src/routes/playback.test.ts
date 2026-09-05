import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { fixturesDir, makeTestConfig, scanAndWait, setupAdmin } from '../test-utils.js';

const fixtures = fixturesDir();
const t = makeTestConfig();
let app: FastifyInstance;
let headers: Record<string, string>;
const fileIds: Record<string, string> = {};

const chrome = {
  name: 'Chrome',
  containers: ['mp4', 'webm', 'mkv'],
  videoCodecs: ['h264', 'vp9'],
  audioCodecs: ['aac', 'opus'],
  maxWidth: null,
  maxBitrate: null,
  hlsSegmentContainer: 'fmp4',
};
const safari = {
  ...chrome,
  name: 'Safari',
  containers: ['mp4'],
  videoCodecs: ['h264', 'hevc'],
  audioCodecs: ['aac', 'ac3'],
};

beforeAll(async () => {
  app = await buildApp({ config: t.config });
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
  ).json() as { items: Array<{ id: string; title: string }> };
  for (const item of items.items) {
    const detail = (
      await app.inject({ method: 'GET', url: `/api/items/${item.id}`, headers })
    ).json() as { files: Array<{ id: string; fileName: string }> };
    for (const f of detail.files) fileIds[f.fileName] = f.id;
  }
});
afterAll(async () => {
  await app.close();
  t.cleanup();
});

const decide = (fileId: string, profile: unknown, extra: Record<string, unknown> = {}) =>
  app.inject({
    method: 'POST',
    url: '/api/playback/decide',
    headers,
    payload: { fileId, profile, ...extra },
  });

describe.skipIf(!existsSync(fixtures))('POST /api/playback/decide', () => {
  it('direct plays the mp4 for Chrome', async () => {
    const res = await decide(fileIds['Sample Movie (2019).mp4']!, chrome);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      method: 'direct',
      video: 'copy',
      audio: 'copy',
      url: `/api/files/${fileIds['Sample Movie (2019).mp4']}/stream`,
      sessionId: null,
    });
  });

  it('transcodes the hevc/ac3 mkv for Chrome and opens a session', async () => {
    const res = await decide(fileIds['Sample.Show.S01E02.1080p.WEB.H265-GRP.mkv']!, chrome, {
      startPositionMs: 5000,
    });
    const body = res.json() as { method: string; sessionId: string; url: string; reason: string };
    expect(body).toMatchObject({ method: 'transcode', video: 'transcode', audio: 'transcode' });
    expect(body.url).toBe(`/api/playback/sessions/${body.sessionId}/master.m3u8`);
    expect(body.reason).toContain('hevc');
    expect(app.playback.get(body.sessionId)).toMatchObject({
      startPositionMs: 5000,
      decision: { method: 'transcode' },
    });
  });

  it('remuxes the hevc/ac3 mkv for Safari', async () => {
    const res = await decide(fileIds['Sample.Show.S01E02.1080p.WEB.H265-GRP.mkv']!, safari);
    expect(res.json()).toMatchObject({ method: 'remux', video: 'copy', audio: 'copy' });
  });

  it('remuxes the dual-audio anime to switch to the English track', async () => {
    const anime = fileIds['[SubGroup] Sample Anime - 13 [1080p][HEVC][Dual-Audio].mkv']!;
    expect((await decide(anime, chrome)).json()).toMatchObject({ method: 'direct' });
    expect((await decide(anime, chrome, { audioStreamIndex: 2 })).json()).toMatchObject({
      method: 'remux',
      audio: 'copy',
    });
  });

  it('validates the profile and 404s unknown files', async () => {
    expect((await decide('nope', chrome)).statusCode).toBe(404);
    expect((await decide(fileIds['Sample Movie (2019).mp4']!, { name: 'x' })).statusCode).toBe(400);
  });
});
