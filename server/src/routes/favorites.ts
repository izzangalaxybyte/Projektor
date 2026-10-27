import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { FavoriteError, FavoritesService } from '../favorites/service.js';
import { ItemsService } from '../items/service.js';
import { ProgressService } from '../progress/service.js';
import { ErrorResponse, Id, ItemSummary, LibraryKind } from '../schemas/index.js';
import { SubtitleService } from '../subtitles/service.js';

export const favoritesRoutes: FastifyPluginAsyncZod = async (app) => {
  const favorites = new FavoritesService(app.db);
  const items = new ItemsService(
    app.db,
    new SubtitleService(app.db, app.config, app.log),
    new ProgressService(app.db),
    favorites,
  );

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof FavoriteError) return reply.notFound(error.message);
    throw error;
  });

  app.get(
    '/',
    {
      prefixTrailingSlash: 'no-slash',
      schema: {
        tags: ['favorites'],
        summary: 'Favorite movies and shows, most recently added first',
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          libraryKind: LibraryKind.optional(),
          limit: z.coerce.number().int().positive().max(200).default(50),
        }),
        response: { 200: ItemSummary.array() },
      },
    },
    async (request) =>
      items
        .summaries(favorites.list(request.user!.id), request.user!.id)
        .filter((s) => !request.query.libraryKind || s.libraryKind === request.query.libraryKind)
        .slice(0, request.query.limit),
  );

  app.put(
    '/:itemId',
    {
      schema: {
        tags: ['favorites'],
        summary: 'Add or remove a movie or show from favorites',
        security: [{ bearerAuth: [] }],
        params: z.object({ itemId: Id }),
        body: z.object({ favorite: z.boolean() }),
        response: { 200: z.object({ favorite: z.boolean() }), 404: ErrorResponse },
      },
    },
    async (request) => ({
      favorite: favorites.set(request.user!.id, request.params.itemId, request.body.favorite),
    }),
  );
};
