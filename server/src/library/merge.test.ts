import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { now, openDatabase, schema, type Db } from '../db/index.js';
import { makeTestConfig } from '../test-utils.js';
import { mergeDuplicates } from './merge.js';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

function setup() {
  const t = makeTestConfig();
  cleanups.push(t.cleanup);
  const { db, close } = openDatabase(t.config.dbPath);
  cleanups.push(close);
  const ts = now();
  const libraryId = randomUUID();
  db.insert(schema.libraries)
    .values({ id: libraryId, name: 'A', kind: 'anime', createdAt: ts, updatedAt: ts })
    .run();
  const userId = randomUUID();
  db.insert(schema.users)
    .values({
      id: userId,
      name: 'U',
      pinHash: '',
      isAdmin: true,
      avatarColor: '#ffffff',
      createdAt: ts,
      updatedAt: ts,
    })
    .run();
  return { db, libraryId, userId };
}

function show(db: Db, libraryId: string, title: string, anilistId: number, createdAt: string) {
  const id = randomUUID();
  db.insert(schema.shows)
    .values({
      id,
      libraryId,
      title,
      sortTitle: title.toLowerCase(),
      anilistId,
      createdAt,
      updatedAt: createdAt,
    })
    .run();
  return id;
}

function episode(db: Db, libraryId: string, showId: string, absolute: number, file: string) {
  const id = randomUUID();
  const ts = now();
  db.insert(schema.episodes)
    .values({ id, showId, absoluteNumber: absolute, createdAt: ts, updatedAt: ts })
    .run();
  db.insert(schema.mediaFiles)
    .values({
      id: randomUUID(),
      libraryId,
      path: `/m/${file}`,
      fileName: file,
      sizeBytes: 1,
      mtimeMs: 1,
      episodeId: id,
      createdAt: ts,
      updatedAt: ts,
    })
    .run();
  return id;
}

describe('mergeDuplicates', () => {
  it('folds a sub and a dub folder of one show into the show with more files, keeping progress', () => {
    const { db, libraryId, userId } = setup();
    const sub = show(db, libraryId, 'My Dress-Up Darling', 132405, '2026-01-01');
    const dub = show(db, libraryId, 'My Dress-Up Darling', 132405, '2026-01-02');
    const subEps = [1, 2, 3].map((n) => episode(db, libraryId, sub, n, `sub-${n}.mkv`));
    const dubEp1 = episode(db, libraryId, dub, 1, 'dub-1.mkv');
    episode(db, libraryId, dub, 0, 'dub-special.mkv');
    // Progress only on the dub copy of episode 1, and a later one than the sub copy's.
    db.insert(schema.playbackState)
      .values([
        {
          userId,
          itemId: subEps[0]!,
          itemKind: 'episode',
          positionMs: 10,
          durationMs: 100,
          updatedAt: '2026-02-01',
        },
        {
          userId,
          itemId: dubEp1,
          itemKind: 'episode',
          positionMs: 60,
          durationMs: 100,
          updatedAt: '2026-03-01',
        },
      ])
      .run();

    expect(mergeDuplicates(db, libraryId)).toEqual({ movies: 0, shows: 1 });

    expect(
      db
        .select()
        .from(schema.shows)
        .all()
        .map((s) => s.id),
    ).toEqual([sub]);
    const files = db
      .select({ name: schema.mediaFiles.fileName, ep: schema.mediaFiles.episodeId })
      .from(schema.mediaFiles)
      .all();
    expect(
      files
        .filter((f) => f.ep === subEps[0])
        .map((f) => f.name)
        .sort(),
    ).toEqual(['dub-1.mkv', 'sub-1.mkv']);
    // Episode 0 is never paired; it moves over as its own episode.
    const special = files.find((f) => f.name === 'dub-special.mkv')!;
    const specialEp = db
      .select()
      .from(schema.episodes)
      .where(eq(schema.episodes.id, special.ep!))
      .get()!;
    expect(specialEp.showId).toBe(sub);
    expect(db.select().from(schema.playbackState).all()).toEqual([
      expect.objectContaining({ itemId: subEps[0], positionMs: 60 }),
    ]);
  });

  it('leaves shows with different matches alone', () => {
    const { db, libraryId } = setup();
    show(db, libraryId, 'Bleach', 269, '2026-01-01');
    show(db, libraryId, 'Bleach TYBW', 116674, '2026-01-01');
    expect(mergeDuplicates(db, libraryId)).toEqual({ movies: 0, shows: 0 });
  });
});
