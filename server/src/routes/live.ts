import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { LiveService } from '../live/service.js';
import {
  ErrorResponse,
  GuideQuery,
  LiveCategory,
  LiveChannel,
  LiveProgramme,
  LiveStatus,
} from '../schemas/index.js';

export const liveRoutes: FastifyPluginAsyncZod = async (app) => {
  const live = new LiveService(app.db);
  const sec = { security: [{ bearerAuth: [] }], tags: ['live'] };

  app.get(
    '/status',
    {
      schema: {
        ...sec,
        summary: 'Provider configuration and last refresh',
        response: { 200: LiveStatus },
      },
    },
    async () => {
      const counts = live.counts();
      return { configured: app.live.credentials() !== null, ...app.live.state, ...counts };
    },
  );

  app.post(
    '/refresh',
    {
      preHandler: app.requireAdmin,
      schema: {
        ...sec,
        summary: 'Pull channels and guide from the provider now (admin)',
        response: { 200: LiveStatus, 403: ErrorResponse },
      },
    },
    async () => {
      await app.live.refresh();
      const counts = live.counts();
      return { configured: app.live.credentials() !== null, ...app.live.state, ...counts };
    },
  );

  app.get(
    '/categories',
    {
      schema: {
        ...sec,
        summary: 'Live channel categories',
        response: { 200: LiveCategory.array() },
      },
    },
    async () => live.categories('live'),
  );

  app.get(
    '/channels',
    {
      schema: {
        ...sec,
        summary: 'Live channels with what is on now and next',
        querystring: z.object({ category: z.string().optional() }),
        response: { 200: LiveChannel.array() },
      },
    },
    async (request) => live.channels(request.query.category),
  );

  app.get(
    '/channels/:id',
    {
      schema: {
        ...sec,
        summary: 'One channel',
        params: z.object({ id: z.string() }),
        response: { 200: LiveChannel, 404: ErrorResponse },
      },
    },
    async (request, reply) => live.channel(request.params.id) ?? reply.notFound('No such channel'),
  );

  app.get(
    '/guide',
    {
      schema: {
        ...sec,
        summary: 'Programmes for a channel in a time window',
        querystring: GuideQuery,
        response: { 200: LiveProgramme.array() },
      },
    },
    async (request) => {
      const from = request.query.from
        ? new Date(request.query.from)
        : new Date(Date.now() - 2 * 3600_000);
      const to = request.query.to
        ? new Date(request.query.to)
        : new Date(from.getTime() + 24 * 3600_000);
      return live.guide(request.query.channel, from, to);
    },
  );
};
