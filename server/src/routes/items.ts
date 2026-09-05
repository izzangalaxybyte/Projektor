import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ItemNotFound, ItemsService } from '../items/service.js';
import { metadataDeps } from '../metadata/deps.js';
import { FixMatchError, FixMatchService } from '../metadata/fix-match.js';
import {
  CandidatesQuery,
  ErrorResponse,
  FixMatchRequest,
  Id,
  ItemDetail,
  ItemsQuery,
  ItemSummary,
  MatchCandidate,
  Page,
  PageQuery,
} from '../schemas/index.js';

export const itemsRoutes: FastifyPluginAsyncZod = async (app) => {
  const items = new ItemsService(app.db);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ItemNotFound) return reply.notFound(error.message);
    if (error instanceof FixMatchError) {
      return reply.code(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.statusCode === 404 ? 'Not Found' : 'Bad Request',
        message: error.message,
      });
    }
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

  app.get(
    '/:id/candidates',
    {
      preHandler: app.requireAdmin,
      schema: {
        tags: ['items'],
        summary: 'Search TMDB (and AniList for anime) for possible matches (admin)',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: Id }),
        querystring: CandidatesQuery,
        response: { 200: MatchCandidate.array(), 403: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (request) => {
      const service = new FixMatchService(app.db, metadataDeps(app, request.log));
      return service.candidates(request.params.id, request.query.query, request.query.year);
    },
  );

  app.post(
    '/:id/match',
    {
      preHandler: app.requireAdmin,
      schema: {
        tags: ['items'],
        summary: 'Apply a chosen match and refetch metadata (admin)',
        description:
          'Movies and TV shows take tmdbId. Anime shows take anilistId, tmdbId, and/or seasonOffset.',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: Id }),
        body: FixMatchRequest,
        response: { 200: ItemDetail, 400: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (request) => {
      const service = new FixMatchService(app.db, metadataDeps(app, request.log));
      await service.apply(request.params.id, request.body);
      return items.get(request.params.id);
    },
  );
};
