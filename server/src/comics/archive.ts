// Reading comic books: CBZ/ZIP in place, CBR/RAR (RAR4 and RAR5, in WebAssembly), CB7/7Z and
// CBT/TAR through 7-Zip, and PDF through poppler. Archives that cannot be read page by page are
// extracted once into a size-capped cache.
import { randomUUID } from 'node:crypto';
import { constants, createReadStream, existsSync } from 'node:fs';
import {
  access,
  chmod,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  utimes,
} from 'node:fs/promises';
import path from 'node:path';
import { PassThrough, type Readable } from 'node:stream';
import { XMLParser } from 'fast-xml-parser';
import { execa } from 'execa';
import sharp from 'sharp';
import sevenZipBin from '7zip-bin';
import { createExtractorFromFile } from 'node-unrar-js';
import yauzl from 'yauzl';
import yazl from 'yazl';
import { naturalCompare } from './naming.js';

export const COMIC_FORMATS = ['cbz', 'cbr', 'cb7', 'cbt', 'pdf'] as const;
export type ComicFormat = (typeof COMIC_FORMATS)[number];

export const COMIC_EXTENSIONS = new Map<string, ComicFormat>([
  ['.cbz', 'cbz'],
  ['.zip', 'cbz'],
  ['.cbr', 'cbr'],
  ['.rar', 'cbr'],
  ['.cb7', 'cb7'],
  ['.7z', 'cb7'],
  ['.cbt', 'cbt'],
  ['.tar', 'cbt'],
  ['.pdf', 'pdf'],
]);

const IMAGE_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.jxl': 'image/jxl',
  '.heic': 'image/heic',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};
/** Formats phones cannot draw; served converted to JPEG. */
const CONVERT = new Set(['.tif', '.tiff']);

/** Whether an archive entry is a page: an image, not macOS or Windows debris. */
export function isPageEntry(name: string): boolean {
  const norm = name.replace(/\\/g, '/');
  const base = norm.split('/').at(-1) ?? '';
  if (norm.includes('__MACOSX/') || base.startsWith('.') || /^thumbs\.db$/i.test(base))
    return false;
  return path.extname(base).toLowerCase() in IMAGE_TYPES;
}

export function pageContentType(name: string): string {
  return IMAGE_TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
}

/** The archive's real format from its first bytes: a CBR that is really a ZIP is common. */
export async function detectFormat(filePath: string): Promise<ComicFormat | null> {
  const handle = await open(filePath, 'r');
  try {
    const head = Buffer.alloc(512);
    const { bytesRead } = await handle.read(head, 0, 512, 0);
    const b = head.subarray(0, bytesRead);
    if (b.subarray(0, 4).equals(Buffer.from('PK\x03\x04', 'latin1'))) return 'cbz';
    if (b.subarray(0, 4).equals(Buffer.from('PK\x05\x06', 'latin1'))) return 'cbz';
    if (b.subarray(0, 6).equals(Buffer.from('Rar!\x1a\x07', 'latin1'))) return 'cbr';
    if (b.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))) return 'cb7';
    if (b.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
    if (b.subarray(257, 262).toString('latin1') === 'ustar') return 'cbt';
  } finally {
    await handle.close();
  }
  return COMIC_EXTENSIONS.get(path.extname(filePath).toLowerCase()) ?? null;
}

export interface ComicInfo {
  title: string | null;
  series: string | null;
  number: number | null;
  volume: number | null;
  summary: string | null;
  writer: string | null;
  year: number | null;
  /** From `<Manga>YesAndRightToLeft</Manga>`. */
  rightToLeft: boolean;
}

/** Parses a ComicInfo.xml (the ComicRack schema most taggers write). */
export function parseComicInfo(xml: string): ComicInfo | null {
  try {
    const doc = new XMLParser({ parseTagValue: false, trimValues: true }).parse(xml) as Record<
      string,
      unknown
    >;
    const info = doc['ComicInfo'] as Record<string, unknown> | undefined;
    if (!info || typeof info !== 'object') return null;
    const text = (key: string) => {
      const v = info[key];
      return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
    };
    const num = (key: string) => {
      const v = text(key);
      const n = v === null ? NaN : Number(v);
      return Number.isFinite(n) ? n : null;
    };
    return {
      title: text('Title'),
      series: text('Series'),
      number: num('Number'),
      volume: num('Volume'),
      summary: text('Summary'),
      writer: text('Writer'),
      year: num('Year'),
      rightToLeft: /^yesandrighttoleft$/i.test(text('Manga') ?? ''),
    };
  } catch {
    return null;
  }
}

export interface BookIndex {
  format: ComicFormat;
  /** Page entry names in reading order; empty for PDF, whose pages are numbered. */
  pages: string[];
  pageCount: number;
  comicInfo: ComicInfo | null;
}

/** What the archive layer needs to know about a book. */
export interface BookRef {
  id: string;
  path: string;
  format: ComicFormat;
  pages: string[];
  pageCount: number;
  mtimeMs: number;
}

export interface PageData {
  body: Readable;
  contentType: string;
  size: number | null;
}

export class ComicError extends Error {
  constructor(
    message: string,
    readonly statusCode = 500,
  ) {
    super(message);
  }
}

export interface ArchiveOptions {
  cacheDir: string;
  /** Extracted archives and rendered pages beyond this are evicted, least recently read first. */
  cacheBytes: number;
  pdfinfoPath?: string;
  pdftoppmPath?: string;
  /** Which archive entries are pages; tests swap it to read archives without images. */
  isPage?: (name: string) => boolean;
}

/** Width a PDF page is rendered at when no width is asked for. */
export const PDF_DEFAULT_WIDTH = 2048;

export class ComicArchives {
  private readonly extracting = new Map<string, Promise<string>>();
  /** One eviction at a time; another request while it runs makes it go round once more. */
  private evicting: Promise<void> | null = null;
  private evictAgain = false;
  private evictKeep = '';

  private readonly isPage: (name: string) => boolean;

  constructor(private readonly options: ArchiveOptions) {
    this.isPage = options.isPage ?? isPageEntry;
  }

  /** Lists the pages and reads ComicInfo.xml. */
  async index(filePath: string): Promise<BookIndex> {
    const format = await detectFormat(filePath);
    if (!format) throw new ComicError(`not a comic archive: ${path.basename(filePath)}`, 400);
    if (format === 'pdf') {
      return { format, pages: [], pageCount: await this.pdfPageCount(filePath), comicInfo: null };
    }
    const entries = await this.list(format, filePath);
    const pages = entries.filter(this.isPage).sort(naturalCompare);
    const infoName = entries.find((e) => /(^|[\\/])comicinfo\.xml$/i.test(e));
    let comicInfo: ComicInfo | null = null;
    if (infoName) {
      const xml = await this.readSmallEntry(format, filePath, infoName).catch(() => null);
      if (xml) comicInfo = parseComicInfo(xml.toString('utf8'));
    }
    return { format, pages, pageCount: pages.length, comicInfo };
  }

  /** One page: the original bytes, or a JPEG at [width] (always for PDF). Pages count from 0. */
  async page(book: BookRef, index: number, width: number | null): Promise<PageData> {
    if (!Number.isInteger(index) || index < 0 || index >= book.pageCount) {
      throw new ComicError('No such page', 404);
    }
    if (book.format === 'pdf') return this.pdfPage(book, index, width ?? PDF_DEFAULT_WIDTH);
    const name = book.pages[index]!;
    const ext = path.extname(name).toLowerCase();
    if (width === null && !CONVERT.has(ext)) {
      if (book.format === 'cbz') return this.zipEntry(book.path, name);
      const file = await this.extractedFile(book, name);
      const info = await stat(file);
      return { body: createReadStream(file), contentType: pageContentType(name), size: info.size };
    }
    // Resized (thumbnails) or converted pages are cached beside the extraction.
    const dir = this.dirFor(book);
    const target = path.join(dir, 'pages', `${index}-w${width ?? 0}.jpg`);
    if (!existsSync(target)) {
      const source = await this.pageBuffer(book, name);
      await mkdir(path.dirname(target), { recursive: true });
      const tmp = `${target}.${randomUUID()}.tmp`;
      let img = sharp(source, { failOn: 'none' });
      if (width !== null) img = img.resize({ width, withoutEnlargement: true });
      await img.jpeg({ quality: 88 }).toFile(tmp);
      await rename(tmp, target);
    }
    await this.touch(book);
    const info = await stat(target);
    return { body: createReadStream(target), contentType: 'image/jpeg', size: info.size };
  }

  /** The first page as a buffer, for the cover. */
  async coverBuffer(book: BookRef): Promise<Buffer> {
    if (book.pageCount === 0) throw new ComicError('Book has no pages', 404);
    if (book.format === 'pdf') {
      const data = await this.pdfPage(book, 0, 600);
      return streamToBuffer(data.body);
    }
    const first = book.pages[0]!;
    if (book.format === 'cbz' || existsSync(this.extractedRoot(book))) {
      return this.pageBuffer(book, first);
    }
    // Indexing a library makes a cover per book; extracting whole archives for it would churn
    // the cache through every book in the library, so only the first page comes out.
    return this.readSmallEntry(book.format, book.path, first, true);
  }

  /**
   * The book for reading offline: PDFs as they are; every archive as a CBZ of its pages, stored
   * uncompressed and named 0001.jpg, 0002.png ... in reading order, so any reader gets the same
   * pages in the same order. The page bytes are the originals.
   */
  async download(book: BookRef): Promise<PageData> {
    if (book.format === 'pdf') {
      const info = await stat(book.path);
      return { body: createReadStream(book.path), contentType: 'application/pdf', size: info.size };
    }
    const zip = new yazl.ZipFile();
    const width = String(book.pageCount).length < 4 ? 4 : String(book.pageCount).length;
    const sizes = await this.pageSizes(book);
    book.pages.forEach((name, i) => {
      const entryName = `${String(i + 1).padStart(width, '0')}${path.extname(name).toLowerCase()}`;
      zip.addReadStreamLazy(
        entryName,
        { compress: false, size: sizes[i]!, mtime: new Date(book.mtimeMs) },
        (cb) => {
          const open =
            book.format === 'cbz'
              ? this.zipEntry(book.path, name).then((p) => p.body)
              : this.extractedFile(book, name).then((f) => createReadStream(f));
          open.then(
            (s) => cb(null, s),
            (e: unknown) => cb(e, undefined as unknown as Readable),
          );
        },
      );
    });
    const size = await new Promise<number>((resolve) => {
      zip.end({ forceZip64Format: false, comment: '' }, ((total: number) =>
        resolve(total)) as unknown as () => void);
    });
    const body = new PassThrough();
    zip.outputStream.pipe(body);
    return { body, contentType: 'application/vnd.comicbook+zip', size: size >= 0 ? size : null };
  }

  /** Drops a book's cache (changed on disk, or deleted). */
  async forget(bookId: string): Promise<void> {
    await rm(path.join(this.options.cacheDir, bookId), { recursive: true, force: true });
  }

  // ---- listing -------------------------------------------------------------------------------

  private async list(format: ComicFormat, filePath: string): Promise<string[]> {
    switch (format) {
      case 'cbz':
        return withZip(filePath, async (zip) => {
          const names: string[] = [];
          await eachEntry(zip, (e) => {
            if (!e.fileName.endsWith('/')) names.push(e.fileName);
          });
          return names;
        });
      case 'cbr': {
        const ex = await createExtractorFromFile({ filepath: filePath });
        const names: string[] = [];
        for (const h of ex.getFileList().fileHeaders) if (!h.flags.directory) names.push(h.name);
        return names;
      }
      default: {
        const { stdout } = await execa(await this.sevenZipPath(), [
          'l',
          '-slt',
          '-ba',
          '--',
          filePath,
        ]);
        return stdout
          .split(/\r?\n\r?\n/)
          .map((block) => {
            const field = (k: string) => new RegExp(`^${k} = (.*)$`, 'm').exec(block)?.[1];
            const folder = field('Folder') === '+' || (field('Attributes') ?? '').startsWith('D');
            return folder ? undefined : field('Path');
          })
          .filter((p): p is string => !!p);
      }
    }
  }

  private async readSmallEntry(
    format: ComicFormat,
    filePath: string,
    name: string,
    allowSolid = false,
  ): Promise<Buffer> {
    switch (format) {
      case 'cbz':
        return streamToBuffer((await this.zipEntry(filePath, name)).body);
      case 'cbr': {
        // Solid archives decompress everything before the entry: fine for a cover, which is
        // near the start, but not worth it for the metadata.
        const tmp = path.join(this.options.cacheDir, `.info-${randomUUID()}`);
        await mkdir(tmp, { recursive: true });
        try {
          const ex = await createExtractorFromFile({
            filepath: filePath,
            targetPath: tmp,
            filenameTransform: flatName,
          });
          if (!allowSolid && ex.getFileList().arcHeader.flags.solid) {
            throw new Error('solid archive');
          }
          for (const f of ex.extract({ files: [name] }).files) void f;
          return await readFile(path.join(tmp, flatName(name)));
        } finally {
          await rm(tmp, { recursive: true, force: true });
        }
      }
      default: {
        const { stdout } = await execa(
          await this.sevenZipPath(),
          ['e', '-so', '--', filePath, name],
          {
            encoding: 'buffer',
          },
        );
        return Buffer.from(stdout);
      }
    }
  }

  // ---- pages ---------------------------------------------------------------------------------

  private zipEntry(filePath: string, name: string): Promise<PageData> {
    return new Promise((resolve, reject) => {
      yauzl.open(filePath, { lazyEntries: true, autoClose: false }, (err, zip) => {
        if (err || !zip) return reject(err ?? new Error('zip open failed'));
        let found = false;
        zip.on('entry', (entry: yauzl.Entry) => {
          if (entry.fileName !== name) return zip.readEntry();
          found = true;
          zip.openReadStream(entry, (e, stream) => {
            if (e || !stream) {
              zip.close();
              return reject(e ?? new Error('zip entry unreadable'));
            }
            stream.on('close', () => zip.close());
            stream.on('error', () => zip.close());
            resolve({
              body: stream,
              contentType: pageContentType(name),
              size: entry.uncompressedSize,
            });
          });
        });
        zip.on('end', () => {
          if (!found) {
            zip.close();
            reject(new ComicError('Page missing from archive', 404));
          }
        });
        zip.on('error', reject);
        zip.readEntry();
      });
    });
  }

  private async pageBuffer(book: BookRef, name: string): Promise<Buffer> {
    if (book.format === 'cbz') return streamToBuffer((await this.zipEntry(book.path, name)).body);
    return readFile(await this.extractedFile(book, name));
  }

  private async pageSizes(book: BookRef): Promise<number[]> {
    if (book.format === 'cbz') {
      const sizes = new Map<string, number>();
      await withZip(book.path, (zip) =>
        eachEntry(zip, (e) => void sizes.set(e.fileName, e.uncompressedSize)),
      );
      return book.pages.map((p) => sizes.get(p) ?? 0);
    }
    return Promise.all(
      book.pages.map(async (p) => (await stat(await this.extractedFile(book, p))).size),
    );
  }

  // ---- extraction cache ----------------------------------------------------------------------

  private dirFor(book: BookRef): string {
    return path.join(this.options.cacheDir, book.id);
  }

  /** Where an entry of a RAR, 7Z or TAR book lives once extracted; extracts on first use. */
  private async extractedFile(book: BookRef, name: string): Promise<string> {
    const root = await this.ensureExtracted(book);
    const file =
      book.format === 'cbr' ? path.join(root, flatName(name)) : path.join(root, ...safeParts(name));
    if (!file.startsWith(root + path.sep) || !existsSync(file)) {
      throw new ComicError('Page missing from archive', 404);
    }
    return file;
  }

  private extractedRoot(book: BookRef): string {
    return path.join(this.dirFor(book), `files-${Math.floor(book.mtimeMs)}`);
  }

  private ensureExtracted(book: BookRef): Promise<string> {
    const root = this.extractedRoot(book);
    const running = this.extracting.get(root);
    if (running) return running;
    const job = (async () => {
      if (existsSync(root)) {
        await this.touch(book);
        return root;
      }
      await rm(this.dirFor(book), { recursive: true, force: true });
      const tmp = `${root}.${randomUUID()}.tmp`;
      await mkdir(tmp, { recursive: true });
      try {
        if (book.format === 'cbr') {
          const ex = await createExtractorFromFile({
            filepath: book.path,
            targetPath: tmp,
            filenameTransform: flatName,
          });
          for (const f of ex.extract({ files: (h) => !h.flags.directory && this.isPage(h.name) })
            .files)
            void f;
        } else {
          // -snl-: store symlinks as links is off; 7-Zip already refuses paths outside the target.
          await execa(await this.sevenZipPath(), ['x', '-y', `-o${tmp}`, '--', book.path]);
        }
        await rename(tmp, root);
      } catch (error) {
        await rm(tmp, { recursive: true, force: true });
        throw new ComicError(`could not extract ${path.basename(book.path)}: ${String(error)}`);
      }
      this.scheduleEvict(book.id);
      return root;
    })().finally(() => this.extracting.delete(root));
    this.extracting.set(root, job);
    return job;
  }

  private async touch(book: BookRef): Promise<void> {
    const t = new Date();
    await utimes(this.dirFor(book), t, t).catch(() => undefined);
  }

  /** Evicts in the background; never throws, since nobody waits on it. */
  private scheduleEvict(keep: string): void {
    this.evictKeep = keep;
    if (this.evicting) {
      this.evictAgain = true;
      return;
    }
    this.evicting = (async () => {
      do {
        this.evictAgain = false;
        await this.evict(this.evictKeep).catch(() => undefined);
      } while (this.evictAgain);
    })().finally(() => {
      this.evicting = null;
    });
  }

  /** Removes the least recently read books until the cache fits; never the one just opened. */
  private async evict(keep: string): Promise<void> {
    const dirs = await readdir(this.options.cacheDir, { withFileTypes: true }).catch(() => []);
    const found = await Promise.all(
      dirs
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map(async (d) => {
          const full = path.join(this.options.cacheDir, d.name);
          // Gone already: forgotten (book changed or deleted) while this ran.
          const info = await stat(full).catch(() => null);
          if (!info) return null;
          return { id: d.name, full, used: info.mtimeMs, bytes: await dirSize(full) };
        }),
    );
    const books = found.filter((b) => b !== null);
    let total = books.reduce((s, b) => s + b.bytes, 0);
    for (const b of books.sort((x, y) => x.used - y.used)) {
      if (total <= this.options.cacheBytes) break;
      if (b.id === keep || [...this.extracting.keys()].some((k) => k.startsWith(b.full))) continue;
      await rm(b.full, { recursive: true, force: true });
      total -= b.bytes;
    }
  }

  // ---- PDF -----------------------------------------------------------------------------------

  private async pdfPageCount(filePath: string): Promise<number> {
    const { stdout } = await execa(this.options.pdfinfoPath ?? 'pdfinfo', [filePath]);
    const pages = /^Pages:\s+(\d+)/m.exec(stdout);
    if (!pages) throw new ComicError('pdfinfo reported no page count');
    return Number(pages[1]);
  }

  private async pdfPage(book: BookRef, index: number, width: number): Promise<PageData> {
    const target = path.join(this.dirFor(book), 'pdf', `${index}-w${width}.jpg`);
    if (!existsSync(target)) {
      await mkdir(path.dirname(target), { recursive: true });
      const prefix = `${target}.${randomUUID()}`;
      await execa(this.options.pdftoppmPath ?? 'pdftoppm', [
        '-f',
        String(index + 1),
        '-l',
        String(index + 1),
        '-scale-to-x',
        String(width),
        '-scale-to-y',
        '-1',
        '-jpeg',
        '-jpegopt',
        'quality=92',
        '-singlefile',
        book.path,
        prefix,
      ]);
      await rename(`${prefix}.jpg`, target);
      this.scheduleEvict(book.id);
    }
    await this.touch(book);
    const info = await stat(target);
    return { body: createReadStream(target), contentType: 'image/jpeg', size: info.size };
  }

  private sevenZipPath(): Promise<string> {
    return sevenZipPath();
  }
}

let sevenZip: Promise<string> | null = null;

/** The bundled 7-Zip; its execute bit does not always survive packaging, so restore it. */
export function sevenZipPath(): Promise<string> {
  sevenZip ??= (async () => {
    const bundled = sevenZipBin.path7za;
    try {
      await access(bundled, constants.X_OK);
      return bundled;
    } catch {
      try {
        await chmod(bundled, 0o755);
        return bundled;
      } catch {
        return '7z';
      }
    }
  })();
  return sevenZip;
}

/** An archive entry name as one safe file name: folders joined with "__", no "..". */
export function flatName(name: string): string {
  return safeParts(name).join('__') || 'entry';
}

function safeParts(name: string): string[] {
  return name
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p !== '' && p !== '.' && p !== '..');
}

async function withZip<T>(filePath: string, fn: (zip: yauzl.ZipFile) => Promise<T>): Promise<T> {
  const zip = await yauzl.openPromise(filePath, { lazyEntries: true, autoClose: false });
  try {
    return await fn(zip);
  } finally {
    zip.close();
  }
}

function eachEntry(zip: yauzl.ZipFile, onEntry: (e: yauzl.Entry) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    zip.on('entry', (e: yauzl.Entry) => {
      onEntry(e);
      zip.readEntry();
    });
    zip.on('end', () => resolve());
    zip.on('error', reject);
    zip.readEntry();
  });
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true }).catch(() => [])) {
    if (e.isFile())
      total += (await stat(path.join(e.parentPath, e.name)).catch(() => ({ size: 0 }))).size;
  }
  return total;
}
