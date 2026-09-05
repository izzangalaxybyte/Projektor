import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ItemsService } from '../items/service.js';
import { ProgressError, ProgressService } from '../progress/service.js';
import {
  ErrorResponse,
  Id,
  ItemSummary,
  LibraryKind,
  ProgressState,
  ProgressUpdateRequest,
} from '../schemas/index.js';
import { SubtitleService } from '../subtitles/service.js';

export const progressRoutes: FastifyPluginAsyncZod = async (app) => {
  const progress = new ProgressService(app.db);
  const items = new ItemsService(
    app.db,
    new SubtitleService(app.db, app.config, app.log),
    progress,
  );

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ProgressError) return reply.notFound(error.message);
    throw error;
  });

  app.post(
    '/',
    {
      prefixTrailingSlash: 'no-slash',
      schema: {
        tags: ['progress'],
        summary: 'Report the playback position of a movie or episode',
        description:
          'Positions at or past 90% of the duration mark the item watched. Send every few seconds and on pause or stop.',
        security: [{ bearerAuth: [] }],
        body: ProgressUpdateRequest,
        response: { 200: ProgressState, 404: ErrorResponse },
      },
    },
    async (request) =>
      progress.update(
        request.user!.id,
        request.body.itemId,
        request.body.positionMs,
        request.body.durationMs,
      ),
  );

  app.put(
    '/:itemId/watched',
    {
      schema: {
        tags: ['progress'],
        summary: 'Mark a movie or episode watched or unwatched',
        security: [{ bearerAuth: [] }],
        params: z.object({ itemId: Id }),
        body: z.object({ watched: z.boolean() }),
        response: { 200: ProgressState.nullable(), 404: ErrorResponse },
      },
    },
    async (request) =>
      progress.setWatched(request.user!.id, request.params.itemId, request.body.watched),
  );

  app.get(
    '/continue',
    {
      schema: {
        tags: ['progress'],
        summary: 'In-progress movies and episodes, most recent first',
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          libraryKind: LibraryKind.optional(),
          limit: z.coerce.number().int().positive().max(100).default(20),
        }),
        response: { 200: ItemSummary.array() },
      },
    },
    async (request) => {
      const ids = progress.continueWatching(request.user!.id, 200);
      const summaries = items.summaries(ids, request.user!.id);
      return summaries
        .filter((s) => !request.query.libraryKind || s.libraryKind === request.query.libraryKind)
        .slice(0, request.query.limit);
    },
  );
};
