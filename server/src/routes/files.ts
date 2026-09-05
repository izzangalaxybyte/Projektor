import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { schema } from '../db/index.js';
import { ErrorResponse, Id } from '../schemas/index.js';

/** MIME types by canonical container name (see media/ffprobe.ts). */
export const CONTAINER_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  ts: 'video/mp2t',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  mpg: 'video/mpeg',
};

export interface ByteRange {
  start: number;
  end: number;
}

/** Parses a single-range `Range: bytes=a-b` header. Returns null when absent, 'invalid' when unsatisfiable. */
export function parseRange(header: string | undefined, size: number): ByteRange | null | 'invalid' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid';
  let start: number;
  let end: number;
  if (m[1] === '') {
    // Suffix range: last N bytes.
    const suffix = Number(m[2]);
    if (suffix === 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size)
    return 'invalid';
  return { start, end };
}

export const filesRoutes: FastifyPluginAsyncZod = async (app) => {
  const params = z.object({ id: Id });

  const handler = async (
    request: { params: { id: string }; headers: Record<string, unknown>; method: string },
    reply: FastifyReply,
  ) => {
    const file = app.db
      .select()
      .from(schema.mediaFiles)
      .where(eq(schema.mediaFiles.id, request.params.id))
      .get();
    if (!file || file.missing) return reply.notFound('No such file');
    const info = await stat(file.path).catch(() => null);
    if (!info?.isFile()) return reply.notFound('File is not on disk');
    const size = info.size;
    const mime = (file.container && CONTAINER_MIME[file.container]) || 'application/octet-stream';

    const range = parseRange(request.headers['range'] as string | undefined, size);
    const base: Record<string, string> = {
      'accept-ranges': 'bytes',
      'content-type': mime,
      'cache-control': 'private, no-transform',
    };
    if (range === 'invalid') {
      return reply
        .code(416)
        .headers({ ...base, 'content-range': `bytes */${size}` })
        .send();
    }
    const status = range === null ? 200 : 206;
    const start = range?.start ?? 0;
    const end = range?.end ?? size - 1;
    const headers: Record<string, string> = { ...base, 'content-length': String(end - start + 1) };
    if (range) headers['content-range'] = `bytes ${start}-${end}/${size}`;

    if (request.method === 'HEAD') {
      // Fastify's automatic HEAD handling replaces content-length with 0 for an empty body, so
      // write the headers straight to the socket.
      reply.hijack();
      reply.raw.writeHead(status, headers);
      reply.raw.end();
      return;
    }
    return reply.code(status).headers(headers).send(createReadStream(file.path, { start, end }));
  };

  const schemaOpts = {
    tags: ['playback'],
    summary: 'Direct play: the original file with byte-range support',
    description:
      'Send `Range: bytes=a-b` for partial content. Players that cannot set headers may pass the bearer token as `?access_token=`.',
    security: [{ bearerAuth: [] }],
    params,
    querystring: z.object({ access_token: z.string().optional() }),
    response: { 404: ErrorResponse, 416: z.null() },
  };
  // Fastify exposes HEAD for every GET automatically; the handler checks request.method.
  app.get('/:id/stream', { schema: schemaOpts }, handler);
};
