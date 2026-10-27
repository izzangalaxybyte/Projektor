import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { fixturesDir, makeTestConfig, scanAndWait, setupAdmin } from '../test-utils.js';

const anime = path.join(fixturesDir(), 'anime');
const t = makeTestConfig();
let app: FastifyInstance;
let headers: Record<string, string>;
let fileId: string;

const chrome = {
  name: 'Chrome',
  containers: ['mp4', 'webm', 'mkv'],
  videoCodecs: ['h264', 'hevc'],
  audioCodecs: ['aac', 'opus'],
  maxWidth: null,
  maxBitrate: null,
  hlsSegmentContainer: 'fmp4',
};

beforeAll(async () => {
  app = await buildApp({ config: t.config });
  await app.ready();
  headers = { authorization: `Bearer ${(await setupAdmin(app)).token}` };
  if (!existsSync(anime)) return;
  const create = await app.inject({
    method: 'POST',
    url: '/api/libraries',
    headers,
    payload: { name: 'Anime', kind: 'anime', paths: [anime] },
  });
  await scanAndWait(app, headers, (create.json() as { id: string }).id);
  fileId = app.db.query.mediaFiles.findFirst().sync()!.id;
});
afterAll(async () => {
  await app.close();
  t.cleanup();
});

const decide = async (extra: Record<string, unknown> = {}) =>
  (
    await app.inject({
      method: 'POST',
      url: '/api/playback/decide',
      headers,
      payload: { fileId, profile: chrome, ...extra },
    })
  ).json() as {
    method: string;
    audioStreamIndex: number | null;
    preferredSubtitleId: string | null;
    subtitlesOff: boolean;
  };
const choose = (payload: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: '/api/playback/track-choice',
    headers,
    payload: { fileId, ...payload },
  });

describe.skipIf(!existsSync(anime))('track choices for a show', () => {
  it('starts with nothing remembered', async () => {
    expect(await decide()).toMatchObject({
      method: 'direct',
      audioStreamIndex: null,
      preferredSubtitleId: null,
      subtitlesOff: false,
    });
  });

  it("applies the show's last audio and subtitle picks to later playback", async () => {
    expect((await choose({ audioStreamIndex: 2, subtitlesOff: true })).statusCode).toBe(204);
    expect(await decide()).toMatchObject({
      method: 'remux',
      audioStreamIndex: 2,
      subtitlesOff: true,
    });

    const sub = (
      (
        await app.inject({
          method: 'POST',
          url: '/api/playback/decide',
          headers,
          payload: { fileId, profile: chrome },
        })
      ).json() as {
        subtitles: Array<{ id: string }>;
      }
    ).subtitles[0]!;
    await choose({ subtitleId: sub.id });
    expect(await decide()).toMatchObject({
      audioStreamIndex: 2,
      preferredSubtitleId: sub.id,
      subtitlesOff: false,
    });
  });

  it("lets the request's own audio win", async () => {
    expect(await decide({ audioStreamIndex: 1 })).toMatchObject({ audioStreamIndex: 1 });
  });
});
