import { readFile } from 'node:fs/promises';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ErrorResponse } from '../schemas/index.js';
import { SubtitleError, SubtitleService } from '../subtitles/service.js';

export const subtitlesRoutes: FastifyPluginAsyncZod = async (app) => {
  const subtitles = new SubtitleService(app.db, app.config, app.log);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof SubtitleError) {
      return reply.code(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.statusCode === 404 ? 'Not Found' : 'Internal Server Error',
        message: error.message,
      });
    }
    throw error;
  });

  app.get(
    '/:id.vtt',
    {
      schema: {
        tags: ['playback'],
        summary: 'A subtitle track as WebVTT, converted from its source on first request',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().min(1) }),
        querystring: z.object({ access_token: z.string().optional() }),
        response: { 404: ErrorResponse, 500: ErrorResponse },
      },
    },
    async (request, reply) => {
      const file = await subtitles.ensureVtt(request.params.id);
      return reply
        .header('content-type', 'text/vtt; charset=utf-8')
        .header('cache-control', 'private, max-age=86400')
        .send((await readFile(file)) as never);
    },
  );
};
