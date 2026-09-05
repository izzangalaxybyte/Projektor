import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { isSampleDir, isSampleFile, walkVideos } from './walker.js';

describe('isSampleFile', () => {
  it('recognises the usual release sample names', () => {
    expect(isSampleFile('Sample.mkv')).toBe(true);
    expect(isSampleFile('shrek.2.2004.2160p-sample.mkv')).toBe(true);
    expect(isSampleFile('shrek.2.2004.sample.mkv')).toBe(true);
    expect(isSampleFile('Shrek 2 (2004) [sample].mkv')).toBe(true);
    expect(isSampleFile('Shrek 2 (2004).mkv')).toBe(false);
    expect(isSampleFile('Sampler.mkv')).toBe(false);
    expect(isSampleFile('Sample.Show.S01E02.1080p.WEB.H265-GRP.mkv')).toBe(false);
    expect(isSampleFile('Sample Movie (2019).mkv')).toBe(false);
    expect(isSampleFile('The Sample Man (2011).mkv')).toBe(false);
  });
  it('recognises sample folders', () => {
    expect(isSampleDir('Sample')).toBe(true);
    expect(isSampleDir('samples')).toBe(true);
    expect(isSampleDir('Extras')).toBe(false);
  });
});

describe('walkVideos', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'projektor-walk-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('skips sample files and sample folders', async () => {
    mkdirSync(path.join(dir, 'Movie (2004)', 'Sample'), { recursive: true });
    writeFileSync(path.join(dir, 'Movie (2004)', 'Movie (2004).mkv'), 'x'.repeat(2000));
    writeFileSync(path.join(dir, 'Movie (2004)', 'movie-sample.mkv'), 'x'.repeat(100));
    writeFileSync(path.join(dir, 'Movie (2004)', 'Sample', 'clip.mkv'), 'x'.repeat(100));
    const seen: string[] = [];
    for await (const f of walkVideos(dir)) seen.push(f.fileName);
    expect(seen).toEqual(['Movie (2004).mkv']);
  });
});
