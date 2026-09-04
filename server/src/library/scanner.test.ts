import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, now, schema } from '../db/index.js';
import { makeTestConfig } from '../test-utils.js';
import { scanLibrary } from './scanner.js';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

function makeTree(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'projektor-tree-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'Show/Season 01'), { recursive: true });
  mkdirSync(path.join(root, '.hidden'), { recursive: true });
  writeFileSync(path.join(root, 'Movie (2001).mkv'), 'a');
  writeFileSync(path.join(root, 'Show/Season 01/Show - S01E01.mp4'), 'bb');
  writeFileSync(path.join(root, 'Show/Season 01/Show - S01E01.srt'), 'not video');
  writeFileSync(path.join(root, 'Show/poster.jpg'), 'not video');
  writeFileSync(path.join(root, '.hidden/secret.mkv'), 'skipped');
  return root;
}

function makeLibrary(dbPath: string, root: string) {
  const handle = openDatabase(dbPath);
  cleanups.push(handle.close);
  const id = randomUUID();
  const ts = now();
  handle.db
    .insert(schema.libraries)
    .values({ id, name: 'Test', kind: 'movie', createdAt: ts, updatedAt: ts })
    .run();
  handle.db
    .insert(schema.libraryPaths)
    .values({ id: randomUUID(), libraryId: id, path: root })
    .run();
  return { db: handle.db, id };
}

describe('scanLibrary', () => {
  it('indexes video files only, skips hidden entries, and is idempotent', async () => {
    const t = makeTestConfig();
    cleanups.push(t.cleanup);
    const root = makeTree();
    const { db, id } = makeLibrary(t.config.dbPath, root);

    const first = await scanLibrary(db, id);
    expect(first).toMatchObject({ filesSeen: 2, filesChanged: 2, filesMissing: 0 });
    expect(first.changedFileIds).toHaveLength(2);

    const second = await scanLibrary(db, id);
    expect(second).toMatchObject({
      filesSeen: 2,
      filesChanged: 0,
      filesMissing: 0,
      changedFileIds: [],
    });

    const rows = db.select().from(schema.mediaFiles).all();
    expect(rows.map((r) => r.fileName).sort()).toEqual(['Movie (2001).mkv', 'Show - S01E01.mp4']);
    expect(rows.every((r) => r.probedAt === null)).toBe(true);
  });

  it('detects modified files, flags missing ones, and clears the flag when they return', async () => {
    const t = makeTestConfig();
    cleanups.push(t.cleanup);
    const root = makeTree();
    const { db, id } = makeLibrary(t.config.dbPath, root);
    await scanLibrary(db, id);

    const movie = path.join(root, 'Movie (2001).mkv');
    writeFileSync(movie, 'a much longer body');
    utimesSync(movie, new Date(), new Date(Date.now() + 5000));
    const episode = path.join(root, 'Show/Season 01/Show - S01E01.mp4');
    rmSync(episode);

    const changed = await scanLibrary(db, id);
    expect(changed).toMatchObject({ filesSeen: 1, filesChanged: 1, filesMissing: 1 });
    const missingRow = db
      .select()
      .from(schema.mediaFiles)
      .all()
      .find((r) => r.path === episode);
    expect(missingRow?.missing).toBe(true);

    writeFileSync(episode, 'bb');
    const back = await scanLibrary(db, id);
    expect(back).toMatchObject({ filesMissing: 0 });
    const backRow = db
      .select()
      .from(schema.mediaFiles)
      .all()
      .find((r) => r.path === episode);
    // Same size and mtime as originally recorded is unlikely, so it counts as changed and is unflagged.
    expect(backRow?.missing).toBe(false);
  });

  it('continues past unreadable directories', async () => {
    const t = makeTestConfig();
    cleanups.push(t.cleanup);
    const root = makeTree();
    const { db, id } = makeLibrary(t.config.dbPath, root);
    db.insert(schema.libraryPaths)
      .values({ id: randomUUID(), libraryId: id, path: path.join(root, 'does-not-exist') })
      .run();
    const result = await scanLibrary(db, id);
    expect(result.filesSeen).toBe(2);
  });
});
