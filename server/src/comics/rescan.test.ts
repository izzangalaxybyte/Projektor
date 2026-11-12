import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { schema } from '../db/index.js';
import { makeTestConfig, scanAndWait, setupAdmin } from '../test-utils.js';
import { makeCbz } from './test-fixtures.js';

let app: FastifyInstance;
let headers: Record<string, string>;
let libraryId: string;
const t = makeTestConfig();
const root = path.join(t.config.dataDir, 'comics-library');

beforeAll(async () => {
  mkdirSync(path.join(root, 'Hero'), { recursive: true });
  // The file name carries no number; ComicInfo does.
  await makeCbz(path.join(root, 'Hero', 'Hero.cbz'), [{ name: '001.png' }], {
    'ComicInfo.xml': '<ComicInfo><Number>5</Number><Volume>2</Volume></ComicInfo>',
  });
  app = await buildApp({ config: t.config });
  await app.ready();
  headers = { authorization: `Bearer ${(await setupAdmin(app)).token}` };
  const res = await app.inject({
    method: 'POST',
    url: '/api/libraries',
    headers,
    payload: { name: 'Comics', kind: 'comic', paths: [root] },
  });
  libraryId = (res.json() as { id: string }).id;
}, 60_000);
afterAll(async () => {
  await app.close();
  t.cleanup();
});

const numbering = () => {
  const book = app.db.select().from(schema.comicBooks).get()!;
  return { volume: book.volume, chapter: book.chapter };
};

describe('rescanning comics', () => {
  it('keeps the numbering read from ComicInfo when nothing changed', async () => {
    await scanAndWait(app, headers, libraryId);
    expect(numbering()).toEqual({ volume: 2, chapter: 5 });
    await scanAndWait(app, headers, libraryId);
    expect(numbering()).toEqual({ volume: 2, chapter: 5 });
  });

  it('reads the numbering again for books that lost it before the fix', async () => {
    // What rescans used to leave behind, and the migration that marks such books unindexed.
    app.db.update(schema.comicBooks).set({ volume: null, chapter: null }).run();
    const migration = readFileSync(
      path.join(import.meta.dirname, '../../drizzle/0011_reindex_unnumbered_comics.sql'),
      'utf8',
    );
    app.db.run(sql.raw(migration));
    await scanAndWait(app, headers, libraryId);
    expect(numbering()).toEqual({ volume: 2, chapter: 5 });
  });
});
