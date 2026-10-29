import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { copyFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import yauzl from 'yauzl';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ComicArchives,
  detectFormat,
  isPageEntry,
  parseComicInfo,
  type BookRef,
} from './archive.js';
import { makeCbz, makePdf, makeWith7z } from './test-fixtures.js';

const testdata = path.join(import.meta.dirname, 'testdata');
let dir: string;
let archives: ComicArchives;

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'comic-archive-'));
  archives = new ComicArchives({ cacheDir: path.join(dir, 'cache'), cacheBytes: 50 * 1024 * 1024 });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function ref(file: string, a = archives): Promise<BookRef> {
  const index = await a.index(file);
  return {
    id: path.basename(file).replace(/\W/g, '_'),
    path: file,
    format: index.format,
    pages: index.pages,
    pageCount: index.pageCount,
    mtimeMs: 1,
  };
}

async function bytes(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Buffer));
  return Buffer.concat(chunks);
}

describe('page entries', () => {
  it('keeps images, drops debris', () => {
    expect(isPageEntry('001.jpg')).toBe(true);
    expect(isPageEntry('Chapter 1/002.WEBP')).toBe(true);
    expect(isPageEntry('__MACOSX/._001.jpg')).toBe(false);
    expect(isPageEntry('.hidden.png')).toBe(false);
    expect(isPageEntry('ComicInfo.xml')).toBe(false);
    expect(isPageEntry('Thumbs.db')).toBe(false);
  });
});

describe('ComicInfo.xml', () => {
  it('reads the fields and the manga reading direction', () => {
    const info = parseComicInfo(
      '<?xml version="1.0"?><ComicInfo><Title>Romance Dawn</Title><Series>One Piece</Series><Number>1</Number><Volume>1</Volume><Writer>Oda</Writer><Year>1997</Year><Manga>YesAndRightToLeft</Manga></ComicInfo>',
    );
    expect(info).toMatchObject({
      title: 'Romance Dawn',
      series: 'One Piece',
      number: 1,
      volume: 1,
      writer: 'Oda',
      year: 1997,
      rightToLeft: true,
    });
    expect(parseComicInfo('<ComicInfo><Manga>Yes</Manga></ComicInfo>')?.rightToLeft).toBe(false);
    expect(parseComicInfo('not xml at all <')).toBeNull();
  });
});

describe('CBZ', () => {
  it('lists pages in natural order and serves the original bytes', async () => {
    const file = path.join(dir, 'book.cbz');
    await makeCbz(
      file,
      [
        { name: 'p10.png' },
        { name: 'p2.png', width: 120, height: 60 },
        { name: 'p1.png' },
        { name: '__MACOSX/._p1.png' },
      ],
      {
        'ComicInfo.xml': '<ComicInfo><Manga>YesAndRightToLeft</Manga><Title>T</Title></ComicInfo>',
      },
    );
    const book = await ref(file);
    expect(book.format).toBe('cbz');
    expect(book.pages).toEqual(['p1.png', 'p2.png', 'p10.png']);
    expect((await archives.index(file)).comicInfo).toMatchObject({ rightToLeft: true, title: 'T' });

    const page = await archives.page(book, 1, null);
    expect(page.contentType).toBe('image/png');
    const meta = await sharp(await bytes(page.body)).metadata();
    expect([meta.width, meta.height]).toEqual([120, 60]);

    const thumb = await archives.page(book, 1, 60);
    expect(thumb.contentType).toBe('image/jpeg');
    expect((await sharp(await bytes(thumb.body)).metadata()).width).toBe(60);
    await expect(archives.page(book, 3, null)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('recognises a CBR that is really a ZIP by its bytes', async () => {
    const file = path.join(dir, 'mislabelled.cbr');
    await makeCbz(file, [{ name: '1.png' }]);
    expect(await detectFormat(file)).toBe('cbz');
  });

  it('downloads as a CBZ with pages renamed in reading order', async () => {
    const book = await ref(path.join(dir, 'book.cbz'));
    const data = await archives.download(book);
    const buffer = await bytes(data.body);
    expect(data.size).toBe(buffer.length);
    const zip = await yauzl.fromBufferPromise(buffer, { lazyEntries: true });
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
  });
});

describe('CB7 and CBT', () => {
  for (const type of ['7z', 'tar'] as const) {
    it(`extracts ${type} pages once, including ones in folders`, async () => {
      const file = path.join(dir, `book.${type === '7z' ? 'cb7' : 'cbt'}`);
      await makeWith7z(file, type, [
        { name: 'ch1/01.png' },
        { name: 'ch2/01.png', width: 90 },
        { name: 'ch1/02.png' },
      ]);
      const book = await ref(file);
      expect(book.format).toBe(type === '7z' ? 'cb7' : 'cbt');
      expect(book.pages).toEqual(['ch1/01.png', 'ch1/02.png', 'ch2/01.png']);
      const page = await archives.page(book, 2, null);
      expect((await sharp(await bytes(page.body)).metadata()).width).toBe(90);
      // Downloads repack the extracted pages.
      const data = await archives.download(book);
      expect((await bytes(data.body)).length).toBe(data.size);
    });
  }
});

describe('CBR', () => {
  // The fixtures hold text files; read them as pages to exercise RAR listing and extraction.
  const textPages = new ComicArchives({
    cacheDir: path.join(os.tmpdir(), `comic-rar-${process.pid}`),
    cacheBytes: 10 * 1024 * 1024,
    isPage: (name) => name.endsWith('.txt'),
  });

  it.each(['rar5-solid.rar', 'rar3-solid.rar'])(
    'reads %s, solid archives included',
    async (name) => {
      const file = path.join(dir, name.replace('.rar', '.cbr'));
      await copyFile(path.join(testdata, name), file);
      const book = await ref(file, textPages);
      expect(book.format).toBe('cbr');
      expect(book.pages).toEqual(['stest1.txt', 'stest2.txt']);
      const text = (await bytes((await textPages.page(book, 1, null)).body)).toString('utf8');
      expect(text.length).toBeGreaterThan(100);
    },
  );

  it('reads entries in folders and with non-ASCII names', async () => {
    const file = path.join(dir, 'subdirs.cbr');
    await copyFile(path.join(testdata, 'rar5-subdirs.rar'), file);
    const book = await ref(file, textPages);
    expect(book.pages).toContain('sub/üȵĩöḋè/file.txt');
    const i = book.pages.indexOf('sub/üȵĩöḋè/file.txt');
    expect((await bytes((await textPages.page(book, i, null)).body)).length).toBeGreaterThan(0);
  });

  it('never writes outside the cache for a path-traversal archive', async () => {
    const file = path.join(dir, 'evil.cbr');
    await copyFile(path.join(testdata, 'rar5-evil-symlink-traversal.rar'), file);
    const evil = new ComicArchives({
      cacheDir: path.join(dir, 'evil-cache'),
      cacheBytes: 1 << 20,
      isPage: () => true,
    });
    const book = await ref(file, evil);
    await Promise.all(
      book.pages.map((_, i) =>
        evil
          .page(book, i, null)
          .then((p) => bytes(p.body))
          .catch(() => null),
      ),
    );
    expect(existsSync(path.join(dir, 'pwned.txt'))).toBe(false);
    expect(existsSync(path.join(dir, 'evil-cache', '..', 'pwned.txt'))).toBe(false);
  });
});

describe('PDF', () => {
  it('counts pages and renders them at the asked width', async () => {
    const file = path.join(dir, 'book.pdf');
    await makePdf(file, [
      [200, 300],
      [400, 300],
    ]);
    const book = await ref(file);
    expect(book).toMatchObject({ format: 'pdf', pageCount: 2, pages: [] });
    const page = await archives.page(book, 1, 800);
    expect(page.contentType).toBe('image/jpeg');
    const meta = await sharp(await bytes(page.body)).metadata();
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(600);
    const cover = await archives.coverBuffer(book);
    expect((await sharp(cover).metadata()).width).toBe(600);
    const download = await archives.download(book);
    expect(download.contentType).toBe('application/pdf');
    expect((await bytes(download.body)).subarray(0, 5).toString()).toBe('%PDF-');
  }, 30_000);
});

describe('cache', () => {
  it('evicts the least recently read extraction when over the cap', async () => {
    const small = new ComicArchives({ cacheDir: path.join(dir, 'small-cache'), cacheBytes: 1 });
    const a = path.join(dir, 'a.cb7');
    const b = path.join(dir, 'b.cb7');
    await makeWith7z(a, '7z', [{ name: '1.png' }]);
    await makeWith7z(b, '7z', [{ name: '1.png' }]);
    await bytes((await small.page(await ref(a, small), 0, null)).body);
    await bytes((await small.page(await ref(b, small), 0, null)).body);
    await new Promise((r) => setTimeout(r, 100));
    const left = await readdir(path.join(dir, 'small-cache'));
    expect(left).toEqual(['b_cb7']);
  });

  it('makes covers without extracting the whole book', async () => {
    const cacheDir = path.join(dir, 'cover-cache');
    const covers = new ComicArchives({ cacheDir, cacheBytes: 50 * 1024 * 1024 });
    const file = path.join(dir, 'cover.cb7');
    await makeWith7z(file, '7z', [
      { name: '01.png', width: 30 },
      { name: '02.png' },
      { name: '03.png' },
    ]);
    const cover = await covers.coverBuffer(await ref(file, covers));
    expect((await sharp(cover).metadata()).width).toBe(30);
    // A solid RAR too: its first page comes out on its own.
    const rarCovers = new ComicArchives({
      cacheDir,
      cacheBytes: 50 * 1024 * 1024,
      isPage: (name) => name.endsWith('.txt'),
    });
    const rar = path.join(dir, 'cover.cbr');
    await copyFile(path.join(testdata, 'rar5-solid.rar'), rar);
    const rarBook = await ref(rar, rarCovers);
    const first = (await rarCovers.coverBuffer(rarBook)).toString('utf8');
    const page = (await bytes((await rarCovers.page(rarBook, 0, null)).body)).toString('utf8');
    expect(first).toBe(page);
    await rarCovers.forget(rarBook.id);
    const left = await readdir(cacheDir).catch(() => []);
    expect(left.filter((n) => !n.startsWith('.'))).toEqual([]);
  });

  it('survives books being forgotten while it evicts', async () => {
    const racing = new ComicArchives({ cacheDir: path.join(dir, 'race-cache'), cacheBytes: 1 });
    const books = await Promise.all(
      Array.from({ length: 12 }, async (_, i) => {
        const file = path.join(dir, `race-${i}.cb7`);
        await makeWith7z(file, '7z', [{ name: '1.png' }, { name: '2.png' }]);
        return ref(file, racing);
      }),
    );
    // Each extraction starts an eviction that lists the cache while other books are forgotten.
    for (let round = 0; round < 4; round++) {
      await Promise.all(
        books.map(async (book, i) => {
          await bytes((await racing.page(book, i % 2, null)).body).catch(() => null);
          await racing.forget(book.id);
        }),
      );
    }
    await new Promise((r) => setTimeout(r, 300));
  }, 60_000);
});
