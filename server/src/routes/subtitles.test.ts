import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
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
  // The anime fixture again, with a font attached the way fansub releases ship them.
  const fonted = path.join(mediaDir, 'Fonted Anime (2020)');
  mkdirSync(fonted, { recursive: true });
  writeFileSync(path.join(dataDir, 'Brush Script.ttf'), 'not really a font');
  await execa('ffmpeg', [
    ...['-v', 'error', '-y', '-i'],
    `${fixtures}/anime/[SubGroup] Sample Anime - 13 [1080p][HEVC][Dual-Audio].mkv`,
    ...['-map', '0', '-c', 'copy', '-attach', path.join(dataDir, 'Brush Script.ttf')],
    ...['-metadata:s:t', 'mimetype=application/x-truetype-font'],
    path.join(fonted, 'Fonted Anime (2020).mkv'),
  ]);
  // Several embedded tracks in one file, like a fansub release: the ASS track twice and an srt.
  const many = path.join(mediaDir, 'Many Tracks (2021)');
  mkdirSync(many, { recursive: true });
  await execa('ffmpeg', [
    ...['-v', 'error', '-y'],
    ...['-i', `${fixtures}/anime/[SubGroup] Sample Anime - 13 [1080p][HEVC][Dual-Audio].mkv`],
    ...['-i', `${fixtures}/tv/Sample.Show.S01E02.1080p.WEB.H265-GRP.mkv`],
    ...['-map', '0:v', '-map', '0:a:0', '-map', '0:s', '-map', '0:s', '-map', '1:s', '-c', 'copy'],
    path.join(many, 'Many Tracks (2021).mkv'),
  ]);
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

  it('converts every embedded track of a file in one pass on the first request', async () => {
    const file = files['Many Tracks (2021).mkv']!;
    expect(file.subtitles.map((s) => s.format)).toEqual(['ass', 'ass', 'subrip']);
    const first = await app.inject({ method: 'GET', url: file.subtitles[0]!.url, headers });
    expect(first.body).toContain('Styled first line');
    // The others are already on disk, the ASS ones as scripts too.
    const dir = path.join(dataDir, 'subtitles', file.id);
    for (const s of file.subtitles) expect(existsSync(path.join(dir, `${s.id}.vtt`))).toBe(true);
    for (const s of file.subtitles.slice(0, 2))
      expect(existsSync(path.join(dir, `${s.id}.ass`))).toBe(true);
    const srt = await app.inject({ method: 'GET', url: file.subtitles[2]!.url, headers });
    expect(srt.body).toContain('First subtitle line');
    const ass = await app.inject({
      method: 'GET',
      url: `/api/subtitles/${file.subtitles[1]!.id}.ass`,
      headers,
    });
    expect(ass.body).toContain('{\\an8}Styled first line');
  });

  it('serves ASS tracks as written, with the fonts attached to the file', async () => {
    const anime = files['[SubGroup] Sample Anime - 13 [1080p][HEVC][Dual-Audio].mkv']!;
    const sub = anime.subtitles[0]! as (typeof anime.subtitles)[number] & {
      assUrl: string | null;
      fontsUrl: string | null;
    };
    expect(sub.assUrl).toBe(`/api/subtitles/${sub.id}.ass`);
    const ass = await app.inject({ method: 'GET', url: sub.assUrl!, headers });
    expect(ass.statusCode).toBe(200);
    expect(ass.headers['content-type']).toContain('text/x-ssa');
    expect(ass.body).toContain('[V4+ Styles]');
    expect(ass.body).toContain('Style: Default,Arial,24');
    expect(ass.body).toContain('{\\an8}Styled first line');
    expect((await app.inject({ method: 'GET', url: sub.fontsUrl!, headers })).json()).toEqual([]);

    const fonted = files['Fonted Anime (2020).mkv']!.subtitles[0]! as typeof sub;
    const fonts = (
      await app.inject({ method: 'GET', url: `${fonted.fontsUrl}?access_token=${token}` })
    ).json() as Array<{ name: string; url: string }>;
    expect(fonts).toEqual([
      { name: 'Brush Script.ttf', url: `/api/subtitles/${fonted.id}/fonts/0` },
    ]);
    const font = await app.inject({ method: 'GET', url: fonts[0]!.url, headers });
    expect(font.headers['content-type']).toBe('font/ttf');
    expect(font.body).toBe('not really a font');
    expect(
      (await app.inject({ method: 'GET', url: `/api/subtitles/${fonted.id}/fonts/1`, headers }))
        .statusCode,
    ).toBe(404);

    const srt = files['Sample.Show.S01E02.1080p.WEB.H265-GRP.mkv']!.subtitles[0]! as typeof sub;
    expect(srt.assUrl).toBeNull();
    expect(
      (await app.inject({ method: 'GET', url: `/api/subtitles/${srt.id}.ass`, headers }))
        .statusCode,
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
