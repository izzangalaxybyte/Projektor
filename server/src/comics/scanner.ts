// Comic libraries: books on disk become series and books, then each new or changed book is
// indexed (pages listed, ComicInfo.xml read, cover made).
import { createHash, randomUUID } from 'node:crypto';
import { opendir, stat } from 'node:fs/promises';
import path from 'node:path';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import pLimit from 'p-limit';
import sharp from 'sharp';
import { now, schema, type Db } from '../db/index.js';
import type { ImageStore } from '../images/store.js';
import { COMIC_EXTENSIONS, type BookRef, type ComicArchives } from './archive.js';
import {
  isGenericFolderTitle,
  isGroupingFolder,
  parseComicName,
  seriesTitle,
  sortTitle,
} from './naming.js';

export interface ComicScanResult {
  filesSeen: number;
  filesChanged: number;
  filesMissing: number;
  /** New, changed, or never indexed books. */
  changedBookIds: string[];
}

interface Walked {
  path: string;
  root: string;
  fileName: string;
  sizeBytes: number;
  mtimeMs: number;
}

async function* walkComics(root: string, log?: FastifyBaseLogger): AsyncGenerator<Walked> {
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop()!;
    let handle;
    try {
      handle = await opendir(dir);
    } catch (error) {
      log?.warn({ where: dir, error }, 'comic scan: skipping unreadable folder');
      continue;
    }
    for await (const entry of handle) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        pending.push(full);
        continue;
      }
      if (!COMIC_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      try {
        const info = await stat(full);
        if (!info.isFile()) continue;
        yield {
          path: full,
          root,
          fileName: entry.name,
          sizeBytes: info.size,
          mtimeMs: Math.floor(info.mtimeMs),
        };
      } catch (error) {
        log?.warn({ where: full, error }, 'comic scan: skipping unreadable file');
      }
    }
  }
}

/**
 * The series a book belongs to: the folder it sits in, stepping up past folders that only split
 * a series ("Volumes", "Chapters", "Vol 01"). Books loose in the library root group by the name
 * their files share ("One Piece v01.cbz" and "One Piece c120.cbz" are both "One Piece"), and so
 * do books loose in a shelf, a folder of series ("Marvel/Avengers - Standoff.cbz"), unless they
 * are named after the shelf folder itself.
 */
export function seriesFor(
  root: string,
  filePath: string,
  shelves: ReadonlySet<string> = new Set(),
): { key: string; title: string } {
  const dirs = path
    .relative(root, path.dirname(filePath))
    .split(path.sep)
    .filter((d) => d !== '');
  const folder = path.join(root, ...dirs);
  if (dirs.length > 0 && shelves.has(folder)) {
    const name = parseComicName(path.basename(filePath)).series;
    if (sortTitle(name) !== sortTitle(seriesTitle(dirs.at(-1)!))) {
      return { key: `${folder}#${sortTitle(name)}`, title: name };
    }
  }
  while (dirs.length > 0 && isGroupingFolder(dirs.at(-1)!)) dirs.pop();
  if (dirs.length > 0) {
    let title = seriesTitle(dirs.at(-1)!);
    // "Annual", or a "Volume 4" that only reads as one once its order prefix is gone.
    if (dirs.length > 1 && (isGenericFolderTitle(title) || isGroupingFolder(title))) {
      title = `${seriesTitle(dirs.at(-2)!)} - ${title}`;
    }
    return { key: path.join(root, ...dirs), title };
  }
  const name = parseComicName(path.basename(filePath)).series;
  return { key: `${root}#${sortTitle(name)}`, title: name };
}

/** Folders holding books of their own and two or more series folders under them. */
export function findShelves(files: readonly { root: string; path: string }[]): Set<string> {
  const looseIn = new Set<string>();
  const subfolders = new Map<string, Set<string>>();
  for (const f of files) {
    const dir = path.dirname(f.path);
    looseIn.add(dir);
    // Every folder between the root and this book has the next one down as a subfolder.
    const parts = path
      .relative(f.root, dir)
      .split(path.sep)
      .filter((d) => d !== '');
    for (let i = 0; i < parts.length; i++) {
      if (isGroupingFolder(parts[i]!)) break;
      const parent = path.join(f.root, ...parts.slice(0, i));
      const set = subfolders.get(parent) ?? new Set<string>();
      set.add(parts[i]!);
      subfolders.set(parent, set);
    }
  }
  const shelves = new Set<string>();
  for (const [dir, subs] of subfolders) {
    if (subs.size >= 2 && looseIn.has(dir)) shelves.add(dir);
  }
  return shelves;
}

/**
 * Reconciles comic_books with the disk. Unchanged books are left alone; a book that vanished is
 * flagged missing, and one that reappears elsewhere with the same name and size takes the old row
 * back, so reading history survives a reorganised folder.
 */
export async function scanComicLibrary(
  db: Db,
  libraryId: string,
  log?: FastifyBaseLogger,
): Promise<ComicScanResult> {
  const roots = db
    .select({ path: schema.libraryPaths.path })
    .from(schema.libraryPaths)
    .where(eq(schema.libraryPaths.libraryId, libraryId))
    .all()
    .map((r) => r.path);
  const books = db
    .select()
    .from(schema.comicBooks)
    .where(eq(schema.comicBooks.libraryId, libraryId))
    .all();
  const byPath = new Map(books.map((b) => [b.path, b]));
  const series = new Map(
    db
      .select({
        id: schema.comicSeries.id,
        key: schema.comicSeries.folderKey,
        title: schema.comicSeries.title,
      })
      .from(schema.comicSeries)
      .where(eq(schema.comicSeries.libraryId, libraryId))
      .all()
      .map((s) => [s.key, s]),
  );
  const result: ComicScanResult = {
    filesSeen: 0,
    filesChanged: 0,
    filesMissing: 0,
    changedBookIds: [],
  };
  const touched = new Set<string>();
  const walked: Walked[] = [];
  for (const root of roots) for await (const file of walkComics(root, log)) walked.push(file);
  const walkedPaths = new Set(walked.map((w) => w.path));
  const shelves = findShelves(walked);
  // Rows whose file is gone, by name and size, for moves.
  const gone = new Map<string, (typeof books)[number]>();
  for (const b of books) if (!walkedPaths.has(b.path)) gone.set(`${b.fileName}\0${b.sizeBytes}`, b);

  const seriesId = (root: string, filePath: string): string => {
    const s = seriesFor(root, filePath, shelves);
    const known = series.get(s.key);
    if (known) {
      // Titles follow the naming rules of the build that made them; refresh them as those improve.
      if (known.title !== s.title) {
        db.update(schema.comicSeries)
          .set({ title: s.title, sortTitle: sortTitle(s.title), updatedAt: now() })
          .where(eq(schema.comicSeries.id, known.id))
          .run();
        known.title = s.title;
      }
      return known.id;
    }
    const id = randomUUID();
    const ts = now();
    db.insert(schema.comicSeries)
      .values({
        id,
        libraryId,
        folderKey: s.key,
        title: s.title,
        sortTitle: sortTitle(s.title),
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
    series.set(s.key, { id, key: s.key, title: s.title });
    return id;
  };

  for (const file of walked) {
    result.filesSeen += 1;
    const n = parseComicName(file.fileName);
    const numbering = { volume: n.volume, chapter: n.chapter, bare: n.bare, special: n.special };
    const ts = now();
    const sid = seriesId(file.root, file.path);
    const existing = byPath.get(file.path) ?? gone.get(`${file.fileName}\0${file.sizeBytes}`);
    if (!existing) {
      const id = randomUUID();
      db.insert(schema.comicBooks)
        .values({
          id,
          libraryId,
          seriesId: sid,
          path: file.path,
          fileName: file.fileName,
          sizeBytes: file.sizeBytes,
          mtimeMs: file.mtimeMs,
          ...numbering,
          createdAt: ts,
          updatedAt: ts,
        })
        .run();
      result.filesChanged += 1;
      result.changedBookIds.push(id);
      continue;
    }
    touched.add(existing.id);
    gone.delete(`${existing.fileName}\0${existing.sizeBytes}`);
    const changed = existing.sizeBytes !== file.sizeBytes || existing.mtimeMs !== file.mtimeMs;
    db.update(schema.comicBooks)
      .set({
        path: file.path,
        fileName: file.fileName,
        seriesId: sid,
        sizeBytes: file.sizeBytes,
        mtimeMs: file.mtimeMs,
        missing: false,
        ...numbering,
        ...(changed ? { indexedAt: null, indexError: null } : {}),
        updatedAt: ts,
      })
      .where(eq(schema.comicBooks.id, existing.id))
      .run();
    if (changed || existing.indexedAt === null) {
      result.filesChanged += 1;
      result.changedBookIds.push(existing.id);
    }
  }

  for (const b of books) {
    if (touched.has(b.id) || b.missing) continue;
    db.update(schema.comicBooks)
      .set({ missing: true, updatedAt: now() })
      .where(eq(schema.comicBooks.id, b.id))
      .run();
    result.filesMissing += 1;
  }

  // Series left with no books (theirs moved to a renamed folder) are dropped. Missing books keep
  // their rows, and so their series, for reading history.
  const empty = db
    .select({ id: schema.comicSeries.id })
    .from(schema.comicSeries)
    .leftJoin(schema.comicBooks, eq(schema.comicBooks.seriesId, schema.comicSeries.id))
    .where(and(eq(schema.comicSeries.libraryId, libraryId), isNull(schema.comicBooks.id)))
    .all()
    .map((r) => r.id);
  if (empty.length > 0)
    db.delete(schema.comicSeries).where(inArray(schema.comicSeries.id, empty)).run();

  db.update(schema.libraries)
    .set({ lastScannedAt: now(), updatedAt: now() })
    .where(eq(schema.libraries.id, libraryId))
    .run();
  return result;
}

export function bookRef(row: typeof schema.comicBooks.$inferSelect): BookRef | null {
  if (!row.format || row.pageCount === null) return null;
  return {
    id: row.id,
    path: row.path,
    format: row.format,
    pages: row.pagesJson ? (JSON.parse(row.pagesJson) as string[]) : [],
    pageCount: row.pageCount,
    mtimeMs: row.mtimeMs,
  };
}

/** Lists each book's pages, reads its ComicInfo.xml, and saves its first page as the cover. */
export async function indexComicBooks(
  db: Db,
  archives: ComicArchives,
  images: ImageStore,
  ids: string[],
  log?: FastifyBaseLogger,
): Promise<{ indexed: number; failed: number }> {
  const limit = pLimit(2);
  let indexed = 0;
  let failed = 0;
  await Promise.all(
    ids.map((id) =>
      limit(async () => {
        const row = db.select().from(schema.comicBooks).where(eq(schema.comicBooks.id, id)).get();
        if (!row) return;
        await archives.forget(id);
        try {
          const index = await archives.index(row.path);
          const info = index.comicInfo;
          const update = {
            format: index.format,
            pageCount: index.pageCount,
            pagesJson: index.format === 'pdf' ? null : JSON.stringify(index.pages),
            title: info?.title ?? null,
            summary: info?.summary ?? null,
            writer: info?.writer ?? null,
            year: info?.year ?? null,
            direction: info?.rightToLeft ? ('rtl' as const) : null,
            // The file name wins; ComicInfo fills in what it does not say.
            volume: row.volume ?? info?.volume ?? null,
            chapter: row.chapter ?? info?.number ?? null,
            indexedAt: now(),
            indexError: index.pageCount === 0 ? 'No pages found' : null,
            updatedAt: now(),
          };
          db.update(schema.comicBooks).set(update).where(eq(schema.comicBooks.id, id)).run();
          const ref = bookRef({ ...row, ...update });
          if (ref && ref.pageCount > 0) {
            const key = createHash('sha1').update(`comic:${id}:${row.mtimeMs}`).digest('hex');
            const cover = await sharp(await archives.coverBuffer(ref), { failOn: 'none' })
              .resize({ width: 600, withoutEnlargement: true })
              .jpeg({ quality: 88 })
              .toBuffer();
            await images.put(key, cover);
            db.update(schema.comicBooks)
              .set({ coverKey: key })
              .where(eq(schema.comicBooks.id, id))
              .run();
          }
          indexed += 1;
        } catch (error) {
          failed += 1;
          log?.warn({ book: row.path, error: String(error) }, 'comic index failed');
          db.update(schema.comicBooks)
            .set({
              indexedAt: now(),
              indexError: String(error).slice(0, 500),
              pageCount: 0,
              updatedAt: now(),
            })
            .where(eq(schema.comicBooks.id, id))
            .run();
        }
      }),
    ),
  );
  return { indexed, failed };
}
