import { mkdirSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import yauzl from 'yauzl';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { makeCbz, makePdf, makeWith7z } from '../comics/test-fixtures.js';
import { makeTestConfig, scanAndWait, setupAdmin } from '../test-utils.js';

let app: FastifyInstance;
let admin: { token: string; id: string };
let libraryId: string;
const t = makeTestConfig();
const root = path.join(t.config.dataDir, 'comics-library');
const asAdmin = () => ({ authorization: `Bearer ${admin.token}` });

interface Book {
  id: string;
  label: string | null;
  fileName: string;
  pageCount: number | null;
  direction: string | null;
  progress: { page: number; finished: boolean } | null;
}

beforeAll(async () => {
  // One Piece the way it often sits on disk: collected volumes, then loose chapters after them.
  const op = path.join(root, 'One Piece (1997)');
  mkdirSync(path.join(op, 'Volumes'), { recursive: true });
  mkdirSync(path.join(op, 'Chapters'), { recursive: true });
  for (const v of [1, 2, 10, 20]) {
    await makeCbz(path.join(op, 'Volumes', `One Piece v${String(v).padStart(2, '0')}.cbz`), [
      { name: '001.png' },
      { name: '002.png', width: 120, height: 60 },
      { name: '010.png' },
    ]);
  }
  for (const c of ['120', '120.5', '121']) {
    await makeCbz(path.join(op, 'Chapters', `One Piece c${c}.cbz`), [
      { name: 'a.png' },
      { name: 'b.png' },
    ]);
  }
  await makeCbz(path.join(op, 'One Piece Color Spread Artbook.cbz'), [{ name: 'x.png' }], {
    'ComicInfo.xml': '<ComicInfo><Manga>YesAndRightToLeft</Manga></ComicInfo>',
  });
  // Loose files in the root group by name; a PDF and a CB7 alongside.
  await makePdf(path.join(root, 'Watchmen 001.pdf'), [
    [200, 300],
    [200, 300],
  ]);
  await makeWith7z(path.join(root, 'Watchmen 002.cb7'), '7z', [
    { name: '1.png' },
    { name: '2.png' },
  ]);

  app = await buildApp({ config: t.config });
  await app.ready();
  admin = await setupAdmin(app);
  const res = await app.inject({
    method: 'POST',
    url: '/api/libraries',
    headers: asAdmin(),
    payload: { name: 'Comics', kind: 'comic', paths: [root] },
  });
  expect(res.statusCode).toBe(201);
  libraryId = (res.json() as { id: string }).id;
  const status = await scanAndWait(app, asAdmin(), libraryId);
  expect(status).toMatchObject({ error: null, filesSeen: 10, filesFailed: 0 });
}, 60_000);
afterAll(async () => {
  await app.close();
  t.cleanup();
});

const get = async <T>(url: string): Promise<T> => {
  const res = await app.inject({ method: 'GET', url, headers: asAdmin() });
  expect(res.statusCode, url).toBe(200);
  return res.json() as T;
};
const seriesId = async (title: string) =>
  (await get<{ id: string; title: string }[]>('/api/comics/series')).find((s) => s.title === title)!
    .id;
const booksOf = async (title: string) =>
  (await get<{ books: Book[] }>(`/api/comics/series/${await seriesId(title)}`)).books;

describe('comic libraries', () => {
  it('groups books into series, above Volumes and Chapters folders', async () => {
    const series =
      await get<{ title: string; bookCount: number; coverKey: string | null }[]>(
        '/api/comics/series',
      );
    expect(series.map((s) => [s.title, s.bookCount])).toEqual([
      ['One Piece', 8],
      ['Watchmen', 2],
    ]);
    expect(series[0]!.coverKey).toMatch(/^[a-f0-9]{40}$/);
  });

  it('orders volumes, then the chapters after them, then extras', async () => {
    const books = await booksOf('One Piece');
    expect(books.map((b) => b.label ?? b.fileName)).toEqual([
      'Vol. 1',
      'Vol. 2',
      'Vol. 10',
      'Vol. 20',
      'Ch. 120',
      'Ch. 120.5',
      'Ch. 121',
      'One Piece Color Spread Artbook.cbz',
    ]);
    expect(books[0]!.pageCount).toBe(3);
    expect(books.at(-1)!.direction).toBe('rtl');
  });

  it('serves original pages, resized pages, and rendered PDF pages', async () => {
    const [v1] = await booksOf('One Piece');
    const page = await app.inject({
      method: 'GET',
      url: `/api/comics/books/${v1!.id}/pages/1`,
      headers: asAdmin(),
    });
    expect(page.headers['content-type']).toBe('image/png');
    expect((await sharp(page.rawPayload).metadata()).width).toBe(120);
    const again = await app.inject({
      method: 'GET',
      url: `/api/comics/books/${v1!.id}/pages/1`,
      headers: { ...asAdmin(), 'if-none-match': page.headers['etag'] as string },
    });
    expect(again.statusCode).toBe(304);
    const thumb = await app.inject({
      method: 'GET',
      url: `/api/comics/books/${v1!.id}/pages/1?w=64`,
      headers: asAdmin(),
    });
    expect((await sharp(thumb.rawPayload).metadata()).width).toBe(64);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/comics/books/${v1!.id}/pages/3`,
          headers: asAdmin(),
        })
      ).statusCode,
    ).toBe(404);

    const [pdf, cb7] = await booksOf('Watchmen');
    expect(pdf!.pageCount).toBe(2);
    const rendered = await app.inject({
      method: 'GET',
      url: `/api/comics/books/${pdf!.id}/pages/0?w=640`,
      headers: asAdmin(),
    });
    expect(rendered.headers['content-type']).toBe('image/jpeg');
    expect((await sharp(rendered.rawPayload).metadata()).width).toBe(640);
    // Query-string tokens work for image loaders that cannot send headers.
    const viaToken = await app.inject({
      method: 'GET',
      url: `/api/comics/books/${cb7!.id}/pages/0?access_token=${admin.token}`,
    });
    expect(viaToken.statusCode).toBe(200);
  });

  it('downloads archives as an ordered CBZ and PDFs as they are', async () => {
    const [v1] = await booksOf('One Piece');
    const res = await app.inject({
      method: 'GET',
      url: `/api/comics/books/${v1!.id}/file`,
      headers: asAdmin(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('One Piece v01.cbz');
    expect(Number(res.headers['content-length'])).toBe(res.rawPayload.length);
    const zip = await yauzl.fromBufferPromise(res.rawPayload, { lazyEntries: true });
    const names: string[] = [];
    await new Promise<void>((resolve) => {
      zip.on('entry', (e: yauzl.Entry) => {
        names.push(e.fileName);
        zip.readEntry();
      });
      zip.on('end', () => resolve());
      zip.readEntry();
    });
    expect(names).toEqual(['0001.png', '0002.png', '0003.png']);

    const [pdf] = await booksOf('Watchmen');
    const part = await app.inject({
      method: 'GET',
      url: `/api/comics/books/${pdf!.id}/file`,
      headers: { ...asAdmin(), range: 'bytes=0-3' },
    });
    expect(part.statusCode).toBe(206);
    expect(part.payload).toBe('%PDF');
  });

  it('tracks progress, continue reading, and history', async () => {
    const books = await booksOf('One Piece');
    const [v1, v2] = books;
    const put = (url: string, payload: Record<string, unknown>) =>
      app.inject({ method: 'PUT', url, headers: asAdmin(), payload });

    expect((await put(`/api/comics/books/${v1!.id}/progress`, { page: 1 })).json()).toMatchObject({
      page: 1,
      finished: false,
    });
    let cont = await get<Book[]>('/api/comics/continue');
    expect(cont.map((b) => b.id)).toEqual([v1!.id]);

    // The last page finishes the book; continue reading moves on to the next one.
    expect((await put(`/api/comics/books/${v1!.id}/progress`, { page: 99 })).json()).toMatchObject({
      page: 2,
      finished: true,
    });
    cont = await get<Book[]>('/api/comics/continue');
    expect(cont.map((b) => b.id)).toEqual([v2!.id]);

    // An offline update older than what is saved is ignored.
    const stale = await put(`/api/comics/books/${v1!.id}/progress`, {
      page: 0,
      at: '2000-01-01T00:00:00.000Z',
    });
    expect(stale.json()).toMatchObject({ page: 2 });

    const history = await get<Book[]>('/api/comics/history');
    expect(history.map((b) => b.id)).toEqual([v1!.id]);

    expect((await put(`/api/comics/books/${v2!.id}/read`, { read: true })).json()).toMatchObject({
      finished: true,
    });
    expect((await put(`/api/comics/books/${v2!.id}/read`, { read: false })).json()).toBeNull();

    const detail = await get<{ previousId: string | null; nextId: string | null }>(
      `/api/comics/books/${v2!.id}`,
    );
    expect(detail).toMatchObject({ previousId: v1!.id, nextId: books[2]!.id });

    const sid = await seriesId('One Piece');
    expect((await put(`/api/comics/series/${sid}/read`, { read: true })).statusCode).toBe(204);
    const series = await get<{ readCount: number; bookCount: number }[]>('/api/comics/series');
    expect(series[0]).toMatchObject({ readCount: 8, bookCount: 8 });
    expect(await get<Book[]>('/api/comics/continue')).toEqual([]);
  });

  it('keeps reading history when a book moves', async () => {
    const before = (await booksOf('One Piece'))[0]!;
    const from = path.join(root, 'One Piece (1997)', 'Volumes', 'One Piece v01.cbz');
    await rename(from, path.join(root, 'One Piece (1997)', 'One Piece v01.cbz'));
    await scanAndWait(app, asAdmin(), libraryId);
    const after = (await booksOf('One Piece'))[0]!;
    expect(after.id).toBe(before.id);
    expect(after.progress).toMatchObject({ finished: true });
  });
});
