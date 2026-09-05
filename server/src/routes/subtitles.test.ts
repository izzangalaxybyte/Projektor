import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { configForDataDir } from '../config.js';
import { withToken } from '../playback/hls.js';
import { fixturesDir, scanAndWait, setupAdmin } from '../test-utils.js';

const fixtures = fixturesDir();
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'projektor-subs-'));
const mediaDir = path.join(dataDir, 'media');
let app: FastifyInstance;
let headers: Record<string, string>;
let token: string;
const files: Record<
  string,
  {
    id: string;
    subtitles: Array<{
      id: string;
      source: string;
      format: string;
      language: string | null;
      title: string | null;
      url: string;
    }>;
  }
> = {};

beforeAll(async () => {
  app = await buildApp({
    config: configForDataDir(dataDir, { logLevel: 'fatal', watchLibraries: false }),
  });
  await app.ready();
  token = (await setupAdmin(app)).token;
  headers = { authorization: `Bearer ${token}` };
  if (!existsSync(fixtures)) return;
  // A movie with two sidecars beside it, plus the fixtures with embedded tracks.
  mkdirSync(path.join(mediaDir, 'Sample Movie (2019)'), { recursive: true });
  copyFileSync(
    path.join(fixtures, 'movies/Sample Movie (2019)/Sample Movie (2019).mp4'),
    path.join(mediaDir, 'Sample Movie (2019)/Sample Movie (2019).mp4'),
  );
  writeFileSync(
    path.join(mediaDir, 'Sample Movie (2019)/Sample Movie (2019).en.srt'),
    '1\n00:00:01,000 --> 00:00:03,000\nSidecar English\n',
  );
  writeFileSync(
    path.join(mediaDir, 'Sample Movie (2019)/Sample Movie (2019).de.forced.srt'),
    '1\n00:00:01,000 --> 00:00:03,000\nErzwungen\n',
  );
  writeFileSync(path.join(mediaDir, 'Sample Movie (2019)/poster.jpg'), 'not a subtitle');
  for (const [name, dir] of [
    ['Local', mediaDir],
    ['TV', `${fixtures}/tv`],
    ['Anime', `${fixtures}/anime`],
  ]) {
    const create = await app.inject({
      method: 'POST',
      url: '/api/libraries',
      headers,
      payload: { name, kind: 'movie', paths: [dir] },
    });
    await scanAndWait(app, headers, (create.json() as { id: string }).id);
  }
  const items = (
    await app.inject({ method: 'GET', url: '/api/items?libraryKind=movie', headers })
  ).json() as { items: Array<{ id: string }> };
  for (const item of items.items) {
    const detail = (
      await app.inject({ method: 'GET', url: `/api/items/${item.id}`, headers })
    ).json() as { files: Array<{ id: string; fileName: string; subtitles: never[] }> };
    for (const f of detail.files) files[f.fileName] = { id: f.id, subtitles: f.subtitles };
  }
});
afterAll(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('withToken', () => {
  it('appends the token to segment lines and URI attributes only', () => {
    const out = withToken(
      '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6.000,\nseg-0.m4s\n\n',
      'abc',
    );
    expect(out).toBe(
      '#EXTM3U\n#EXT-X-MAP:URI="init.mp4?access_token=abc"\n#EXTINF:6.000,\nseg-0.m4s?access_token=abc\n\n',
    );
    expect(withToken('seg-0.ts\n', undefined)).toBe('seg-0.ts\n');
  });
});

describe.skipIf(!existsSync(fixtures))('subtitles', () => {
  it('discovers embedded tracks and sidecars during the scan and lists them on files', async () => {
    const movie = files['Sample Movie (2019).mp4']!;
    expect(movie.subtitles.map((s) => [s.source, s.format, s.language, s.title]).sort()).toEqual([
      ['external', 'subrip', 'de', 'Forced'],
      ['external', 'subrip', 'en', 'en'],
    ]);
    const tv = files['Sample.Show.S01E02.1080p.WEB.H265-GRP.mkv']!;
    expect(tv.subtitles.map((s) => [s.source, s.format, s.language])).toEqual([
      ['embedded', 'subrip', 'eng'],
    ]);
    const anime = files['[SubGroup] Sample Anime - 13 [1080p][HEVC][Dual-Audio].mkv']!;
    expect(anime.subtitles.map((s) => [s.source, s.format, s.language])).toEqual([
      ['embedded', 'ass', 'eng'],
    ]);

    const listed = (
      await app.inject({ method: 'GET', url: `/api/files/${movie.id}/subtitles`, headers })
    ).json() as unknown[];
    expect(listed).toHaveLength(2);
    expect(
      (await app.inject({ method: 'GET', url: '/api/files/nope/subtitles', headers })).statusCode,
    ).toBe(404);
  });

  it('converts embedded srt and ass and sidecar srt to WebVTT on first request', async () => {
    const tvSub = files['Sample.Show.S01E02.1080p.WEB.H265-GRP.mkv']!.subtitles[0]!;
    const srt = await app.inject({ method: 'GET', url: tvSub.url, headers });
    expect(srt.statusCode).toBe(200);
    expect(srt.headers['content-type']).toContain('text/vtt');
    expect(srt.body.startsWith('WEBVTT')).toBe(true);
    expect(srt.body).toContain('First subtitle line');
    // ffmpeg writes the short mm:ss.mmm form, which WebVTT allows.
    expect(srt.body).toMatch(/(00:)?00:01\.000 --> (00:)?00:04\.000/);

    const assSub =
      files['[SubGroup] Sample Anime - 13 [1080p][HEVC][Dual-Audio].mkv']!.subtitles[0]!;
    const ass = await app.inject({ method: 'GET', url: assSub.url, headers });
    expect(ass.body).toContain('Styled first line');
    expect(ass.body).not.toContain('{\\an8}');
    expect(ass.body).toContain('Second <i>italic</i> line');

    const sidecar = files['Sample Movie (2019).mp4']!.subtitles.find((s) => s.language === 'en')!;
    const vtt = await app.inject({ method: 'GET', url: `${sidecar.url}?access_token=${token}` });
    expect(vtt.body).toContain('Sidecar English');
    expect(
      existsSync(
        path.join(dataDir, 'subtitles', files['Sample Movie (2019).mp4']!.id, `${sidecar.id}.vtt`),
      ),
    ).toBe(true);
    expect(
      (await app.inject({ method: 'GET', url: '/api/subtitles/nope.vtt', headers })).statusCode,
    ).toBe(404);
  });

  it('exposes subtitles on the playback decision and as HLS renditions with token propagation', async () => {
    const tv = files['Sample.Show.S01E02.1080p.WEB.H265-GRP.mkv']!;
    const safari = {
      name: 'Safari',
      containers: ['mp4'],
      videoCodecs: ['h264', 'hevc'],
      audioCodecs: ['aac', 'ac3'],
      maxWidth: null,
      maxBitrate: null,
      hlsSegmentContainer: 'ts',
    };
    const decision = (
      await app.inject({
        method: 'POST',
        url: '/api/playback/decide',
        headers,
        payload: { fileId: tv.id, profile: safari },
      })
    ).json() as { sessionId: string; subtitles: Array<{ id: string; url: string }> };
    expect(decision.subtitles).toHaveLength(1);
    expect(decision.subtitles[0]!.url).toBe(`/api/subtitles/${decision.subtitles[0]!.id}.vtt`);

    const master = await app.inject({
      method: 'GET',
      url: `/api/playback/sessions/${decision.sessionId}/master.m3u8?access_token=${token}`,
    });
    expect(master.body).toContain(
      `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="eng",LANGUAGE="eng",DEFAULT=NO,AUTOSELECT=YES,FORCED=NO,URI="sub-${tv.subtitles[0]!.id}.m3u8?access_token=${token}"`,
    );
    expect(master.body).toContain('SUBTITLES="subs"');
    expect(master.body).toContain(`index.m3u8?access_token=${token}`);

    const subPlaylist = await app.inject({
      method: 'GET',
      url: `/api/playback/sessions/${decision.sessionId}/sub-${tv.subtitles[0]!.id}.m3u8?access_token=${token}`,
    });
    expect(subPlaylist.statusCode).toBe(200);
    expect(subPlaylist.body).toContain('#EXTINF:31.000,');
    expect(subPlaylist.body).toContain(`sub-${tv.subtitles[0]!.id}.vtt?access_token=${token}`);
    const vtt = await app.inject({
      method: 'GET',
      url: `/api/playback/sessions/${decision.sessionId}/sub-${tv.subtitles[0]!.id}.vtt?access_token=${token}`,
    });
    expect(vtt.body).toContain('First subtitle line');

    const index = await app.inject({
      method: 'GET',
      url: `/api/playback/sessions/${decision.sessionId}/index.m3u8?access_token=${token}`,
    });
    expect(index.statusCode).toBe(200);
    expect(index.body).toMatch(/seg-0\.ts\?access_token=/);
    const plain = await app.inject({
      method: 'GET',
      url: `/api/playback/sessions/${decision.sessionId}/master.m3u8`,
      headers,
    });
    expect(plain.body).not.toContain('access_token');
  });
});
