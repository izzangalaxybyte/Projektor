import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { RecordingError } from '../live/recorder.js';
import {
  CreateRecordingRequest,
  ErrorResponse,
  Recording,
  RecordingsQuery,
} from '../schemas/index.js';
import { parseRange } from './files.js';

export const recordingsRoutes: FastifyPluginAsyncZod = async (app) => {
  const sec = { security: [{ bearerAuth: [] }], tags: ['recordings'] };
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof RecordingError) {
      const names = { 400: 'Bad Request', 404: 'Not Found', 409: 'Conflict' } as const;
      return reply.code(error.statusCode).send({
        statusCode: error.statusCode,
        error: names[error.statusCode],
        message: error.message,
      });
    }
    throw error;
  });

  app.get(
    '/',
    {
      schema: {
        ...sec,
        summary: 'Recordings, newest first',
        querystring: RecordingsQuery,
        response: { 200: Recording.array() },
      },
    },
    async (request) => app.recorder.list(request.query.state),
  );

  app.post(
    '/',
    {
      schema: {
        ...sec,
        summary: 'Record a channel: now, at a time, or a guide programme',
        description:
          'With `programmeId` the recording runs from the programme start (or now) to its end plus padding. Otherwise it starts at `startAt` (default now) and runs `durationMinutes`, or until stopped.',
        body: CreateRecordingRequest,
        response: { 201: Recording, 400: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (request, reply) =>
      reply.code(201).send(await app.recorder.create(request.body, request.user?.id ?? null)),
  );

  app.get(
    '/:id',
    {
      schema: {
        ...sec,
        summary: 'One recording',
        params: z.object({ id: z.string() }),
        response: { 200: Recording, 404: ErrorResponse },
      },
    },
    async (request, reply) =>
      app.recorder.get(request.params.id) ?? reply.notFound('No such recording'),
  );

  app.post(
    '/:id/stop',
    {
      schema: {
        ...sec,
        summary: 'Stop a running recording (kept as done) or cancel a scheduled one (removed)',
        params: z.object({ id: z.string() }),
        response: { 200: Recording, 404: ErrorResponse, 409: ErrorResponse },
      },
    },
    async (request) => app.recorder.stopRecording(request.params.id),
  );

  app.delete(
    '/:id',
    {
      schema: {
        ...sec,
        summary: 'Delete a recording and its file',
        params: z.object({ id: z.string() }),
        response: { 204: z.null(), 404: ErrorResponse },
      },
    },
    async (request, reply) => {
      await app.recorder.remove(request.params.id);
      return reply.code(204).send(null);
    },
  );

  app.get(
    '/:id/stream',
    {
      schema: {
        ...sec,
        summary: 'The recorded MPEG-TS file with byte ranges; grows while recording',
        params: z.object({ id: z.string() }),
        querystring: z.object({ access_token: z.string().optional() }),
        response: { 404: ErrorResponse, 416: z.null() },
      },
    },
    async (request, reply) => {
      const filePath = app.recorder.filePath(request.params.id);
      if (!filePath) return reply.notFound('This recording has not started');
      const info = await stat(filePath).catch(() => null);
      if (!info?.isFile()) return reply.notFound('The recording file is gone');
      const size = info.size;
      const range = parseRange(request.headers['range'] as string | undefined, size);
      const base: Record<string, string> = {
        'accept-ranges': 'bytes',
        'content-type': 'video/mp2t',
        'cache-control': 'no-store',
      };
      if (range === 'invalid')
        return reply
          .code(416)
          .headers({ ...base, 'content-range': `bytes */${size}` })
          .send(null);
      const status = range === null ? 200 : 206;
      const start = range?.start ?? 0;
      const end = range?.end ?? size - 1;
      const headers: Record<string, string> = {
        ...base,
        'content-length': String(Math.max(0, end - start + 1)),
      };
      if (range) headers['content-range'] = `bytes ${start}-${end}/${size}`;
      if (request.method === 'HEAD' || size === 0) {
        reply.hijack();
        reply.raw.writeHead(status, headers);
        reply.raw.end();
        return;
      }
      return reply
        .code(status as never)
        .headers(headers)
        .send(createReadStream(filePath, { start, end }) as never);
    },
  );
};
