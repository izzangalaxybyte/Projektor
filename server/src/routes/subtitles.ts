import { readFile } from 'node:fs/promises';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ErrorResponse, SubtitleFont } from '../schemas/index.js';
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

  app.get(
    '/:id.ass',
    {
      schema: {
        tags: ['playback'],
        summary: 'An ASS or SSA subtitle track as written, for clients that render it with libass',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().min(1) }),
        querystring: z.object({ access_token: z.string().optional() }),
        response: { 404: ErrorResponse, 500: ErrorResponse },
      },
    },
    async (request, reply) => {
      const file = await subtitles.ensureAss(request.params.id);
      return reply
        .header('content-type', 'text/x-ssa; charset=utf-8')
        .header('cache-control', 'private, max-age=86400')
        .send((await readFile(file)) as never);
    },
  );

  app.get(
    '/:id/fonts',
    {
      schema: {
        tags: ['playback'],
        summary: 'Fonts attached to the media file of an ASS or SSA subtitle',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().min(1) }),
        querystring: z.object({ access_token: z.string().optional() }),
        response: { 200: SubtitleFont.array(), 404: ErrorResponse },
      },
    },
    async (request) => {
      const fonts = await subtitles.fonts(request.params.id);
      return fonts.map((f, i) => ({
        name: f.name,
        url: `/api/subtitles/${request.params.id}/fonts/${i}`,
      }));
    },
  );

  app.get(
    '/:id/fonts/:index',
    {
      schema: {
        tags: ['playback'],
        summary: 'One attached font, by its position in the font list',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().min(1), index: z.coerce.number().int().nonnegative() }),
        querystring: z.object({ access_token: z.string().optional() }),
        response: { 404: ErrorResponse },
      },
    },
    async (request, reply) => {
      const font = (await subtitles.fonts(request.params.id))[request.params.index];
      if (!font) throw new SubtitleError(404, 'No such font');
      return reply
        .header('content-type', font.contentType)
        .header('cache-control', 'private, max-age=604800')
        .send((await readFile(font.path)) as never);
    },
  );
};
