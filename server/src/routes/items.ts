import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ItemNotFound, ItemsService } from '../items/service.js';
import {
  ErrorResponse,
  Id,
  ItemDetail,
  ItemsQuery,
  ItemSummary,
  Page,
  PageQuery,
} from '../schemas/index.js';

export const itemsRoutes: FastifyPluginAsyncZod = async (app) => {
  const items = new ItemsService(app.db);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ItemNotFound) return reply.notFound(error.message);
    throw error;
  });

  app.get(
    '/',
    {
      prefixTrailingSlash: 'no-slash',
      schema: {
        tags: ['items'],
        summary: 'Browse or search items',
        description:
          'Without kind or parentId, lists movies and shows. With parentId set to a show, lists its seasons and season-less episodes; set to a season, lists its episodes.',
        security: [{ bearerAuth: [] }],
        querystring: ItemsQuery.extend(PageQuery.shape),
        response: { 200: Page(ItemSummary) },
      },
    },
    async (request) => items.list(request.query),
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['items'],
        summary: 'Item detail with files, streams, and children',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: Id }),
        response: { 200: ItemDetail, 404: ErrorResponse },
      },
    },
    async (request) => items.get(request.params.id),
  );
};
