import { z } from 'zod';
import { Id, Timestamp } from './common.js';

export const ComicFormat = z.enum(['cbz', 'cbr', 'cb7', 'cbt', 'pdf']).meta({ id: 'ComicFormat' });

export const ReadingDirection = z
  .enum(['ltr', 'rtl'])
  .meta({ id: 'ReadingDirection', description: 'rtl: manga, read right to left' });

export const ComicProgress = z
  .object({
    page: z
      .number()
      .int()
      .nonnegative()
      .meta({ description: '0-based index of the page last shown' }),
    pageCount: z.number().int().nonnegative(),
    finished: z.boolean().meta({ description: 'Reached the last page, or marked read' }),
    updatedAt: Timestamp,
  })
  .meta({ id: 'ComicProgress' });
export type ComicProgress = z.infer<typeof ComicProgress>;

export const ComicBook = z
  .object({
    id: Id,
    seriesId: Id,
    seriesTitle: z.string(),
    libraryId: Id,
    title: z.string().meta({ description: 'ComicInfo title, else the file name without tags' }),
    label: z.string().nullable().meta({
      description: '"Vol. 3", "Ch. 120.5", "Vol. 3 · Ch. 20", "#12"; null when unnumbered',
    }),
    fileName: z.string(),
    format: ComicFormat.nullable().meta({ description: 'Null until the book is indexed' }),
    sizeBytes: z.number().int().nonnegative(),
    pageCount: z.number().int().nonnegative().nullable(),
    volume: z.number().nullable(),
    chapter: z.number().nullable(),
    special: z.boolean(),
    direction: ReadingDirection.nullable().meta({
      description:
        'From ComicInfo.xml, else rtl for a book under a Manga folder; null when neither says',
    }),
    coverKey: z.string().nullable().meta({ description: 'Image key for GET /api/images/{key}' }),
    indexError: z.string().nullable(),
    progress: ComicProgress.nullable(),
  })
  .meta({ id: 'ComicBook' });
export type ComicBook = z.infer<typeof ComicBook>;

export const ComicBookDetail = ComicBook.extend({
  summary: z.string().nullable(),
  writer: z.string().nullable(),
  year: z.number().int().nullable(),
  previousId: Id.nullable().meta({ description: 'The book before this one in reading order' }),
  nextId: Id.nullable().meta({ description: 'The book after this one in reading order' }),
}).meta({ id: 'ComicBookDetail' });
export type ComicBookDetail = z.infer<typeof ComicBookDetail>;

export const ComicSeries = z
  .object({
    id: Id,
    libraryId: Id,
    title: z.string(),
    bookCount: z.number().int().nonnegative(),
    readCount: z.number().int().nonnegative(),
    coverKey: z.string().nullable(),
    direction: ReadingDirection.nullable().meta({
      description: 'rtl when most of its books read right to left',
    }),
    lastReadAt: Timestamp.nullable(),
    createdAt: Timestamp,
  })
  .meta({ id: 'ComicSeries' });
export type ComicSeries = z.infer<typeof ComicSeries>;

export const ComicSeriesDetail = z
  .object({
    series: ComicSeries,
    books: ComicBook.array().meta({
      description: 'Reading order: volumes, then loose chapters, then unnumbered books',
    }),
  })
  .meta({ id: 'ComicSeriesDetail' });
export type ComicSeriesDetail = z.infer<typeof ComicSeriesDetail>;

export const ComicProgressUpdate = z
  .object({
    page: z.number().int().nonnegative(),
    at: Timestamp.optional().meta({
      description:
        'When the page was read, for progress saved offline and sent later. An update older than the stored one is ignored.',
    }),
  })
  .meta({ id: 'ComicProgressUpdate' });
