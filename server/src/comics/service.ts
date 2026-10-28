// The read side of comic libraries: series, books in reading order, and each user's progress.
import { and, desc, eq, inArray } from 'drizzle-orm';
import { now, schema, type Db } from '../db/index.js';
import type {
  ComicBook,
  ComicBookDetail,
  ComicProgress,
  ComicSeries,
  ComicSeriesDetail,
} from '../schemas/index.js';
import { cleanName, compareBooks, numberingLabel, sortTitle } from './naming.js';

type BookRow = typeof schema.comicBooks.$inferSelect;
type SeriesRow = typeof schema.comicSeries.$inferSelect;
type ProgressRow = typeof schema.comicProgress.$inferSelect;

export class ComicNotFound extends Error {}

export type SeriesSort = 'title' | 'added' | 'recent';

export class ComicsService {
  constructor(private readonly db: Db) {}

  listSeries(
    userId: string,
    q: {
      libraryId?: string | undefined;
      search?: string | undefined;
      sort?: SeriesSort | undefined;
    },
  ): ComicSeries[] {
    const rows = this.db
      .select()
      .from(schema.comicSeries)
      .where(q.libraryId ? eq(schema.comicSeries.libraryId, q.libraryId) : undefined)
      .all();
    const needle = q.search ? sortTitle(q.search) : null;
    const filtered = needle
      ? rows.filter((s) => s.sortTitle.includes(needle) || s.title.toLowerCase().includes(needle))
      : rows;
    const books = this.booksOf(filtered.map((s) => s.id));
    const progress = this.progressOf(
      userId,
      books.map((b) => b.id),
    );
    const list = filtered
      .map((s) =>
        this.seriesSummary(
          s,
          books.filter((b) => b.seriesId === s.id),
          progress,
        ),
      )
      .filter((s) => s.bookCount > 0);
    switch (q.sort ?? 'title') {
      case 'added':
        return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      case 'recent':
        return list
          .filter((s) => s.lastReadAt !== null)
          .sort((a, b) => b.lastReadAt!.localeCompare(a.lastReadAt!));
      default: {
        const titles = new Map(filtered.map((s) => [s.id, s.sortTitle]));
        return list.sort((a, b) => titles.get(a.id)!.localeCompare(titles.get(b.id)!));
      }
    }
  }

  series(userId: string, id: string): ComicSeriesDetail {
    const row = this.db
      .select()
      .from(schema.comicSeries)
      .where(eq(schema.comicSeries.id, id))
      .get();
    if (!row) throw new ComicNotFound(`No series ${id}`);
    const books = this.booksOf([id]);
    const progress = this.progressOf(
      userId,
      books.map((b) => b.id),
    );
    return {
      series: this.seriesSummary(row, books, progress),
      books: books.map((b) => toBook(b, row.title, progress.get(b.id))),
    };
  }

  book(userId: string, id: string): ComicBookDetail {
    const row = this.bookRow(id);
    const series = this.db
      .select()
      .from(schema.comicSeries)
      .where(eq(schema.comicSeries.id, row.seriesId))
      .get()!;
    const order = this.booksOf([row.seriesId]);
    const at = order.findIndex((b) => b.id === id);
    const progress = this.progressOf(userId, [id]).get(id);
    return {
      ...toBook(row, series.title, progress),
      summary: row.summary,
      writer: row.writer,
      year: row.year,
      previousId: at > 0 ? order[at - 1]!.id : null,
      nextId: at >= 0 && at < order.length - 1 ? order[at + 1]!.id : null,
    };
  }

  bookRow(id: string): BookRow {
    const row = this.db.select().from(schema.comicBooks).where(eq(schema.comicBooks.id, id)).get();
    if (!row || row.missing) throw new ComicNotFound(`No book ${id}`);
    return row;
  }

  /**
   * Saves the page a user is on. Reaching the last page marks the book read, and it stays read if
   * they go back over it. An update stamped [at] earlier than the saved one (read offline, sent
   * late) is ignored.
   */
  setPage(userId: string, bookId: string, page: number, at?: string): ComicProgress {
    const book = this.bookRow(bookId);
    const pageCount = book.pageCount ?? 0;
    const clamped = Math.max(0, Math.min(page, Math.max(pageCount - 1, 0)));
    const existing = this.progressOf(userId, [bookId]).get(bookId);
    const updatedAt = at ?? now();
    if (existing && existing.updatedAt > updatedAt) return progressOut(existing);
    const row = {
      userId,
      bookId,
      page: clamped,
      pageCount,
      finished: (existing?.finished ?? false) || (pageCount > 0 && clamped >= pageCount - 1),
      updatedAt,
    };
    this.db
      .insert(schema.comicProgress)
      .values(row)
      .onConflictDoUpdate({
        target: [schema.comicProgress.userId, schema.comicProgress.bookId],
        set: {
          page: row.page,
          pageCount: row.pageCount,
          finished: row.finished,
          updatedAt: row.updatedAt,
        },
      })
      .run();
    return progressOut(row);
  }

  /** Marks a book read (at its last page) or unread (history cleared). */
  setRead(userId: string, bookId: string, read: boolean): ComicProgress | null {
    const book = this.bookRow(bookId);
    if (!read) {
      this.db
        .delete(schema.comicProgress)
        .where(
          and(eq(schema.comicProgress.userId, userId), eq(schema.comicProgress.bookId, bookId)),
        )
        .run();
      return null;
    }
    const pageCount = book.pageCount ?? 0;
    const row = {
      userId,
      bookId,
      page: Math.max(pageCount - 1, 0),
      pageCount,
      finished: true,
      updatedAt: now(),
    };
    this.db
      .insert(schema.comicProgress)
      .values(row)
      .onConflictDoUpdate({
        target: [schema.comicProgress.userId, schema.comicProgress.bookId],
        set: { page: row.page, pageCount, finished: true, updatedAt: row.updatedAt },
      })
      .run();
    return progressOut(row);
  }

  setSeriesRead(userId: string, seriesId: string, read: boolean): void {
    this.series(userId, seriesId).books.forEach((b) => this.setRead(userId, b.id, read));
  }

  /**
   * What to read next, most recent first: per series, the book last opened if it is unfinished,
   * else the first unfinished book after it in reading order.
   */
  continueReading(userId: string, limit: number): ComicBook[] {
    const rows = this.db
      .select()
      .from(schema.comicProgress)
      .where(eq(schema.comicProgress.userId, userId))
      .orderBy(desc(schema.comicProgress.updatedAt))
      .all();
    const latestBySeries = new Map<string, ProgressRow>();
    const seriesOf = new Map(
      this.db
        .select({ id: schema.comicBooks.id, seriesId: schema.comicBooks.seriesId })
        .from(schema.comicBooks)
        .where(
          inArray(
            schema.comicBooks.id,
            rows.map((r) => r.bookId),
          ),
        )
        .all()
        .map((b) => [b.id, b.seriesId]),
    );
    for (const r of rows) {
      const s = seriesOf.get(r.bookId);
      if (s && !latestBySeries.has(s)) latestBySeries.set(s, r);
    }
    const out: ComicBook[] = [];
    for (const [seriesId, last] of latestBySeries) {
      if (out.length >= limit) break;
      const detail = this.series(userId, seriesId);
      const at = detail.books.findIndex((b) => b.id === last.bookId);
      const pick = !last.finished
        ? detail.books[at]
        : detail.books.slice(at + 1).find((b) => !b.progress?.finished && (b.pageCount ?? 0) > 0);
      if (pick) out.push(pick);
    }
    return out;
  }

  /** Every book the user has opened, most recently read first. */
  history(userId: string, offset: number, limit: number): ComicBook[] {
    const rows = this.db
      .select({
        progress: schema.comicProgress,
        book: schema.comicBooks,
        series: schema.comicSeries,
      })
      .from(schema.comicProgress)
      .innerJoin(schema.comicBooks, eq(schema.comicBooks.id, schema.comicProgress.bookId))
      .innerJoin(schema.comicSeries, eq(schema.comicSeries.id, schema.comicBooks.seriesId))
      .where(and(eq(schema.comicProgress.userId, userId), eq(schema.comicBooks.missing, false)))
      .orderBy(desc(schema.comicProgress.updatedAt))
      .limit(limit)
      .offset(offset)
      .all();
    return rows.map((r) => toBook(r.book, r.series.title, r.progress));
  }

  /** Books of these series that are on disk, each series in reading order. */
  private booksOf(seriesIds: string[]): BookRow[] {
    if (seriesIds.length === 0) return [];
    return this.db
      .select()
      .from(schema.comicBooks)
      .where(
        and(inArray(schema.comicBooks.seriesId, seriesIds), eq(schema.comicBooks.missing, false)),
      )
      .all()
      .sort((a, b) => a.seriesId.localeCompare(b.seriesId) || compareBooks(a, b));
  }

  private progressOf(userId: string, bookIds: string[]): Map<string, ProgressRow> {
    if (bookIds.length === 0) return new Map();
    const rows: ProgressRow[] = [];
    // SQLite caps bound parameters; big libraries are read in slices.
    for (let i = 0; i < bookIds.length; i += 500) {
      rows.push(
        ...this.db
          .select()
          .from(schema.comicProgress)
          .where(
            and(
              eq(schema.comicProgress.userId, userId),
              inArray(schema.comicProgress.bookId, bookIds.slice(i, i + 500)),
            ),
          )
          .all(),
      );
    }
    return new Map(rows.map((r) => [r.bookId, r]));
  }

  private seriesSummary(
    s: SeriesRow,
    books: BookRow[],
    progress: Map<string, ProgressRow>,
  ): ComicSeries {
    const read = books.filter((b) => progress.get(b.id)?.finished).length;
    const lastReadAt = books
      .map((b) => progress.get(b.id)?.updatedAt)
      .filter((t): t is string => !!t)
      .sort()
      .at(-1);
    const rtl = books.filter((b) => b.direction === 'rtl').length;
    return {
      id: s.id,
      libraryId: s.libraryId,
      title: s.title,
      bookCount: books.length,
      readCount: read,
      coverKey: books.find((b) => b.coverKey)?.coverKey ?? null,
      direction: rtl > 0 && rtl >= books.length / 2 ? 'rtl' : null,
      lastReadAt: lastReadAt ?? null,
      createdAt: s.createdAt,
    };
  }
}

function progressOut(
  r: Pick<ProgressRow, 'page' | 'pageCount' | 'finished' | 'updatedAt'>,
): ComicProgress {
  return { page: r.page, pageCount: r.pageCount, finished: r.finished, updatedAt: r.updatedAt };
}

export function toBook(b: BookRow, seriesTitle: string, progress?: ProgressRow): ComicBook {
  return {
    id: b.id,
    seriesId: b.seriesId,
    seriesTitle,
    libraryId: b.libraryId,
    title: b.title ?? cleanName(b.fileName),
    label: numberingLabel(b),
    fileName: b.fileName,
    format: b.format,
    sizeBytes: b.sizeBytes,
    pageCount: b.pageCount,
    volume: b.volume,
    chapter: b.chapter,
    special: b.special,
    direction: b.direction,
    coverKey: b.coverKey,
    indexError: b.indexError,
    progress: progress ? progressOut(progress) : null,
  };
}
