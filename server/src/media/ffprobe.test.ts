import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixturesDir, makeTestConfig } from '../test-utils.js';
import { canonicalContainer, probeFile, ProbeError } from './ffprobe.js';

const fixtures = fixturesDir();

describe('canonicalContainer', () => {
  it('maps ffprobe demuxer lists to one container name', () => {
    expect(canonicalContainer('matroska,webm', '/x/a.mkv')).toBe('mkv');
    expect(canonicalContainer('matroska,webm', '/x/a.webm')).toBe('webm');
    expect(canonicalContainer('mov,mp4,m4a,3gp,3g2,mj2', '/x/a.mp4')).toBe('mp4');
    expect(canonicalContainer('mov,mp4,m4a,3gp,3g2,mj2', '/x/a.m4v')).toBe('mp4');
    expect(canonicalContainer('mov,mp4,m4a,3gp,3g2,mj2', '/x/a.mov')).toBe('mov');
    expect(canonicalContainer('mpegts', '/x/a.ts')).toBe('ts');
    expect(canonicalContainer('avi', '/x/a.avi')).toBe('avi');
    expect(canonicalContainer('asf', '/x/a.wmv')).toBe('wmv');
  });
});

describe.skipIf(!existsSync(fixtures))('probeFile on generated fixtures', () => {
  it('reads the dual-audio anime file: h264, jpn + eng aac, one ass subtitle', async () => {
    const r = await probeFile(
      'ffprobe',
      path.join(fixtures, 'anime/[SubGroup] Sample Anime - 13 [1080p][HEVC][Dual-Audio].mkv'),
    );
    expect(r.container).toBe('mkv');
    expect(r.durationMs).toBeGreaterThan(29_000);
    expect(r.durationMs).toBeLessThan(31_500);
    expect(r.streams.map((s) => [s.type, s.codec, s.language])).toEqual([
      ['video', 'h264', null],
      ['audio', 'aac', 'jpn'],
      ['audio', 'aac', 'eng'],
      ['subtitle', 'ass', 'eng'],
    ]);
    expect(r.streams[0]).toMatchObject({ width: 640, height: 360 });
    expect(r.streams[1]?.channels).toBe(1);
  });

  it('reads the scene-named episode: hevc, ac3, subrip', async () => {
    const r = await probeFile(
      'ffprobe',
      path.join(fixtures, 'tv/Sample.Show.S01E02.1080p.WEB.H265-GRP.mkv'),
    );
    expect(r.container).toBe('mkv');
    expect(r.streams.map((s) => s.codec)).toEqual(['hevc', 'ac3', 'subrip']);
    expect(r.bitrate).toBeGreaterThan(0);
  });

  it('reads the mp4 movie and reports "und" language as null', async () => {
    const r = await probeFile(
      'ffprobe',
      path.join(fixtures, 'movies/Sample Movie (2019)/Sample Movie (2019).mp4'),
    );
    expect(r.container).toBe('mp4');
    expect(r.streams.map((s) => [s.type, s.codec, s.language])).toEqual([
      ['video', 'h264', null],
      ['audio', 'aac', null],
    ]);
  });

  it('throws ProbeError for a file that is not media', async () => {
    const t = makeTestConfig();
    try {
      const junk = path.join(t.config.dataDir, 'junk.mkv');
      writeFileSync(junk, 'this is not a video');
      await expect(probeFile('ffprobe', junk)).rejects.toBeInstanceOf(ProbeError);
    } finally {
      t.cleanup();
    }
  });
});
