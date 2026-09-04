import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { now, openDatabase, schema } from '../db/index.js';
import { scanLibrary } from '../library/scanner.js';
import { makeTestConfig } from '../test-utils.js';
import { identifyFiles, relativeParentDirs, sortKey } from './identifier.js';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

function tree(files: string[]): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'projektor-ident-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  for (const f of files) {
    mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    writeFileSync(path.join(root, f), 'x');
  }
  return root;
}

function library(kind: 'movie' | 'tv' | 'anime', root: string) {
  const t = makeTestConfig();
  cleanups.push(t.cleanup);
  const handle = openDatabase(t.config.dbPath);
  cleanups.push(handle.close);
  const id = randomUUID();
  const ts = now();
  handle.db
    .insert(schema.libraries)
    .values({ id, name: kind, kind, createdAt: ts, updatedAt: ts })
    .run();
  handle.db
    .insert(schema.libraryPaths)
    .values({ id: randomUUID(), libraryId: id, path: root })
    .run();
  return { db: handle.db, id };
}

describe('sortKey', () => {
  it('drops articles and punctuation', () => {
    expect(sortKey('The Office (US)')).toBe('office us');
    expect(sortKey('Mr. Robot')).toBe('mr robot');
    expect(sortKey('A Quiet Place')).toBe('quiet place');
  });
});

describe('relativeParentDirs', () => {
  it('returns folders between the matching root and the file', () => {
    expect(relativeParentDirs('/media/tv/Show/Season 01/e.mkv', ['/media/tv', '/media'])).toEqual([
      'Show',
      'Season 01',
    ]);
    expect(relativeParentDirs('/media/tv/e.mkv', ['/media/tv'])).toEqual([]);
  });
});

describe('identifyFiles', () => {
  it('groups movie files into movies by title and year', async () => {
    const root = tree([
      'Heat (1995)/Heat.1995.1080p.mkv',
      'Heat (1995)/Heat.1995.720p.mkv',
      'Heat.2023.1080p.mkv',
      'Unknown.Thing.mkv',
    ]);
    const { db, id } = library('movie', root);
    const scan = await scanLibrary(db, id);
    const summary = identifyFiles(db, scan.changedFileIds);
    expect(summary).toEqual({ movies: 4, episodes: 0, skipped: 0 });

    const movies = db
      .select()
      .from(schema.movies)
      .orderBy(schema.movies.title, schema.movies.year)
      .all();
    expect(movies.map((m) => [m.title, m.year, m.needsReview])).toEqual([
      ['Heat', 1995, true],
      ['Heat', 2023, true],
      ['Unknown Thing', null, true],
    ]);
    const heat95 = movies.find((m) => m.year === 1995)!;
    expect(
      db.select().from(schema.mediaFiles).where(eq(schema.mediaFiles.movieId, heat95.id)).all(),
    ).toHaveLength(2);
  });

  it('builds shows, seasons, and episodes from scene names and folder hints', async () => {
    const root = tree([
      'Better Call Saul/Season 01/Better.Call.Saul.S01E01.mkv',
      'Better Call Saul/Season 01/Better.Call.Saul.S01E02.mkv',
      'Better Call Saul/Season 02/Episode 1.mkv',
      'Loose.Show.S03E04.mkv',
      'Loose.Show.S03E04.PROPER.mkv',
      'Mystery/Season 01/whatever.mkv',
    ]);
    const { db, id } = library('tv', root);
    const scan = await scanLibrary(db, id);
    expect(identifyFiles(db, scan.changedFileIds)).toEqual({ movies: 0, episodes: 6, skipped: 0 });

    const shows = db.select().from(schema.shows).orderBy(schema.shows.title).all();
    expect(shows.map((s) => s.title)).toEqual(['Better Call Saul', 'Loose Show', 'Mystery']);

    const saul = shows[0]!;
    const seasons = db
      .select()
      .from(schema.seasons)
      .where(eq(schema.seasons.showId, saul.id))
      .orderBy(schema.seasons.seasonNumber)
      .all();
    expect(seasons.map((s) => s.seasonNumber)).toEqual([1, 2]);
    const saulEpisodes = db
      .select()
      .from(schema.episodes)
      .where(eq(schema.episodes.showId, saul.id))
      .all();
    expect(saulEpisodes.map((e) => [e.seasonNumber, e.episodeNumber]).sort()).toEqual([
      [1, 1],
      [1, 2],
      [2, 1],
    ]);

    // Two files for the same episode share one episode row.
    const loose = shows[1]!;
    const looseEpisodes = db
      .select()
      .from(schema.episodes)
      .where(eq(schema.episodes.showId, loose.id))
      .all();
    expect(looseEpisodes).toHaveLength(1);
    expect(
      db
        .select()
        .from(schema.mediaFiles)
        .where(eq(schema.mediaFiles.episodeId, looseEpisodes[0]!.id))
        .all(),
    ).toHaveLength(2);

    // No episode number: kept as its own review-needed episode in the season folder.
    const mystery = shows[2]!;
    const mysteryEpisodes = db
      .select()
      .from(schema.episodes)
      .where(eq(schema.episodes.showId, mystery.id))
      .all();
    expect(mysteryEpisodes).toHaveLength(1);
    expect(mysteryEpisodes[0]).toMatchObject({
      seasonNumber: 1,
      episodeNumber: null,
      title: 'Mystery',
    });
  });

  it('skips files that failed probing and is idempotent', async () => {
    const root = tree(['Show.S01E01.mkv', 'broken.mkv']);
    const { db, id } = library('tv', root);
    const scan = await scanLibrary(db, id);
    const broken = db
      .select()
      .from(schema.mediaFiles)
      .all()
      .find((f) => f.fileName === 'broken.mkv')!;
    db.update(schema.mediaFiles)
      .set({ probedAt: now(), probeJson: JSON.stringify({ error: 'nope' }) })
      .where(eq(schema.mediaFiles.id, broken.id))
      .run();
    expect(identifyFiles(db, scan.changedFileIds)).toEqual({ movies: 0, episodes: 1, skipped: 1 });
    // The broken file stays unlinked, so it is reported as skipped again; nothing is created twice.
    expect(identifyFiles(db, scan.changedFileIds)).toEqual({ movies: 0, episodes: 0, skipped: 1 });
    expect(db.select().from(schema.episodes).all()).toHaveLength(1);
  });
});
