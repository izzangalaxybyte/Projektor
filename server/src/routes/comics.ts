import { createReadStream } from 'node:fs';
import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ComicError } from '../comics/archive.js';
import { bookRef } from '../comics/scanner.js';
import { ComicNotFound, ComicsService } from '../comics/service.js';
import {
  ComicBook,
  ComicBookDetail,
  ComicProgress,
  ComicProgressUpdate,
  ComicSeries,
  ComicSeriesDetail,
  ErrorResponse,
  Id,
} from '../schemas/index.js';
import { parseRange } from './files.js';

export const comicsRoutes: FastifyPluginAsyncZod = async (app) => {
  const comics = new ComicsService(app.db);
  const params = z.object({ id: Id });
  const tokenQuery = { access_token: z.string().optional() };

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ComicNotFound) return reply.notFound(error.message);
    if (error instanceof ComicError) {
      return reply.code(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.statusCode === 404 ? 'Not Found' : 'Internal Server Error',
        message: error.message,
      });
    }
    throw error;
  });

  /** A book that can be read: indexed, with pages. */
  const readable = (id: string) => {
    const ref = bookRef(comics.bookRow(id));
    if (!ref || ref.pageCount === 0) throw new ComicError('This book could not be read', 404);
    return ref;
  };

  app.get(
    '/series',
    {
      schema: {
        tags: ['comics'],
        summary: 'Comic and manga series',
        description:
          'sort=title (default), added (newest first), or recent (series read most recently, read ones only).',
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          libraryId: Id.optional(),
          search: z.string().optional(),
          sort: z.enum(['title', 'added', 'recent']).default('title'),
        }),
        response: { 200: ComicSeries.array() },
      },
    },
    async (request) => comics.listSeries(request.user!.id, request.query),
  );

  app.get(
    '/series/:id',
    {
      schema: {
        tags: ['comics'],
        summary: 'A series and its books in reading order',
        security: [{ bearerAuth: [] }],
        params,
        response: { 200: ComicSeriesDetail, 404: ErrorResponse },
      },
    },
    async (request) => comics.series(request.user!.id, request.params.id),
  );

  app.put(
    '/series/:id/read',
    {
      schema: {
        tags: ['comics'],
        summary: 'Mark every book of a series read or unread',
        security: [{ bearerAuth: [] }],
        params,
        body: z.object({ read: z.boolean() }),
        response: { 204: z.null(), 404: ErrorResponse },
      },
    },
    async (request, reply) => {
      comics.setSeriesRead(request.user!.id, request.params.id, request.body.read);
      return reply.code(204).send(null);
    },
  );

  app.get(
    '/books/:id',
    {
      schema: {
        tags: ['comics'],
        summary: 'A book, with the books before and after it',
        security: [{ bearerAuth: [] }],
        params,
        response: { 200: ComicBookDetail, 404: ErrorResponse },
      },
    },
    async (request) => comics.book(request.user!.id, request.params.id),
  );

  app.get(
    '/books/:id/pages/:page',
    {
      schema: {
        tags: ['comics'],
        summary: 'One page image',
        description:
          'Pages count from 0. Without `w` an archive page is the original image, byte for byte; with `w` (or always for PDF, 2048 wide by default) a JPEG at that width. Readers that cannot set headers may pass `?access_token=`.',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: Id, page: z.coerce.number().int().nonnegative() }),
        querystring: z.object({
          w: z.coerce.number().int().min(64).max(4096).optional(),
          ...tokenQuery,
        }),
        response: { 404: ErrorResponse },
      },
    },
    async (request, typedReply) => {
      // Binary bodies and 304s are outside the typed responses; files.ts streams the same way.
      const reply = typedReply as unknown as FastifyReply;
      const ref = readable(request.params.id);
      // Widths are rounded up to 64 px so a handful of cached sizes serve every screen.
      const w = request.query.w ? Math.ceil(request.query.w / 64) * 64 : null;
      const etag = `"${ref.id}-${ref.mtimeMs}-${request.params.page}-${w ?? 'o'}"`;
      if (request.headers['if-none-match'] === etag) return reply.code(304).send();
      const page = await app.comicArchives.page(ref, request.params.page, w);
      reply
        .header('content-type', page.contentType)
        .header('cache-control', 'private, max-age=604800')
        .header('etag', etag);
      if (page.size !== null) reply.header('content-length', String(page.size));
      return reply.send(page.body);
    },
  );

  app.get(
    '/books/:id/file',
    {
      schema: {
        tags: ['comics'],
        summary: 'The book for reading offline',
        description:
          'PDFs as they are (with byte ranges). Archives as an uncompressed CBZ of the original page images named 0001.jpg, 0002.png ... in reading order.',
        security: [{ bearerAuth: [] }],
        params,
        querystring: z.object(tokenQuery),
        response: { 404: ErrorResponse, 416: z.null() },
      },
    },
    async (request, typedReply) => {
      const reply = typedReply as unknown as FastifyReply;
      const ref = readable(request.params.id);
      const book = comics.bookRow(ref.id);
      const data = await app.comicArchives.download(ref);
      const ext = ref.format === 'pdf' ? 'pdf' : 'cbz';
      const name = `${book.fileName.replace(/\.[^.]+$/, '')}.${ext}`.replace(/["\\\r\n]/g, '_');
      const headers: Record<string, string> = {
        'content-type': data.contentType,
        'content-disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'accept-ranges': ref.format === 'pdf' ? 'bytes' : 'none',
        'cache-control': 'private, no-transform',
      };
      let status = 200;
      let body = data.body;
      if (ref.format === 'pdf' && data.size !== null) {
        const range = parseRange(request.headers['range'], data.size);
        if (range === 'invalid') {
          data.body.destroy();
          return reply
            .code(416)
            .headers({ ...headers, 'content-range': `bytes */${data.size}` })
            .send();
        }
        if (range) {
          data.body.destroy();
          body = createReadStream(ref.path, { start: range.start, end: range.end });
          headers['content-range'] = `bytes ${range.start}-${range.end}/${data.size}`;
          headers['content-length'] = String(range.end - range.start + 1);
          status = 206;
        }
      }
      if (!headers['content-length'] && data.size !== null)
        headers['content-length'] = String(data.size);
      if (request.method === 'HEAD') {
        body.destroy();
        reply.hijack();
        reply.raw.writeHead(status, headers);
        reply.raw.end();
        return;
      }
      return reply.code(status).headers(headers).send(body);
    },
  );

  app.put(
    '/books/:id/progress',
    {
      schema: {
        tags: ['comics'],
        summary: 'Save the page being read',
        description:
          'Reaching the last page marks the book read. Send on every page turn (debounced) and when the reader closes.',
        security: [{ bearerAuth: [] }],
        params,
        body: ComicProgressUpdate,
        response: { 200: ComicProgress, 404: ErrorResponse },
      },
    },
    async (request) =>
      comics.setPage(request.user!.id, request.params.id, request.body.page, request.body.at),
  );

  app.put(
    '/books/:id/read',
    {
      schema: {
        tags: ['comics'],
        summary: 'Mark a book read, or unread (removes it from history)',
        security: [{ bearerAuth: [] }],
        params,
        body: z.object({ read: z.boolean() }),
        response: { 200: ComicProgress.nullable(), 404: ErrorResponse },
      },
    },
    async (request) => comics.setRead(request.user!.id, request.params.id, request.body.read),
  );

  app.get(
    '/continue',
    {
      schema: {
        tags: ['comics'],
        summary:
          'Continue reading: per series, the unfinished book or the next one, most recent first',
        security: [{ bearerAuth: [] }],
        querystring: z.object({ limit: z.coerce.number().int().positive().max(100).default(20) }),
        response: { 200: ComicBook.array() },
      },
    },
    async (request) => comics.continueReading(request.user!.id, request.query.limit),
  );

  app.get(
    '/history',
    {
      schema: {
        tags: ['comics'],
        summary: 'Reading history: every book opened, most recently read first',
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          offset: z.coerce.number().int().nonnegative().default(0),
          limit: z.coerce.number().int().positive().max(200).default(50),
        }),
        response: { 200: ComicBook.array() },
      },
    },
    async (request) => comics.history(request.user!.id, request.query.offset, request.query.limit),
  );
};
