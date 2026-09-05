import { randomUUID } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { now, openDatabase, schema } from '../db/index.js';
import { scanLibrary } from '../library/scanner.js';
import { fixturesDir, makeTestConfig } from '../test-utils.js';
import { probeFiles } from './probe-service.js';

const fixtures = fixturesDir();
const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

describe.skipIf(!existsSync(fixtures))('probeFiles', () => {
  it('stores container, duration, and streams for every changed file, and tolerates a broken one', async () => {
    const t = makeTestConfig();
    cleanups.push(t.cleanup);
    const handle = openDatabase(t.config.dbPath);
    cleanups.push(handle.close);
    const { db } = handle;
    const libraryId = randomUUID();
    const ts = now();
    db.insert(schema.libraries)
      .values({ id: libraryId, name: 'All', kind: 'anime', createdAt: ts, updatedAt: ts })
      .run();
    db.insert(schema.libraryPaths).values({ id: randomUUID(), libraryId, path: fixtures }).run();
    // A junk file inside a second path so the scan picks it up.
    writeFileSync(path.join(t.config.dataDir, 'broken.mkv'), 'nope');
    db.insert(schema.libraryPaths)
      .values({ id: randomUUID(), libraryId, path: t.config.dataDir })
      .run();

    const scan = await scanLibrary(db, libraryId);
    expect(scan.changedFileIds).toHaveLength(5);
    const summary = await probeFiles(db, scan.changedFileIds, {
      ffprobePath: 'ffprobe',
      concurrency: 2,
    });
    expect(summary).toEqual({ probed: 4, failed: 1 });

    const files = db.select().from(schema.mediaFiles).all();
    expect(files.every((f) => f.probedAt !== null)).toBe(true);
    const anime = files.find((f) => f.fileName.startsWith('[SubGroup]'))!;
    expect(anime.container).toBe('mkv');
    expect(anime.durationMs).toBeGreaterThan(29_000);
    const animeStreams = db
      .select()
      .from(schema.streams)
      .where(eq(schema.streams.fileId, anime.id))
      .all();
    expect(animeStreams.filter((s) => s.type === 'audio')).toHaveLength(2);
    expect(animeStreams.filter((s) => s.type === 'subtitle').map((s) => s.codec)).toEqual(['ass']);

    const broken = files.find((f) => f.fileName === 'broken.mkv')!;
    expect(broken.container).toBeNull();
    expect(JSON.parse(broken.probeJson!)).toHaveProperty('error');

    // Probing again replaces streams rather than duplicating them.
    await probeFiles(db, [anime.id], { ffprobePath: 'ffprobe' });
    expect(
      db.select().from(schema.streams).where(eq(schema.streams.fileId, anime.id)).all(),
    ).toHaveLength(4);
  });
});
