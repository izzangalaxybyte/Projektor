// IPTV Movies and IPTV Series: provider VOD listed, matched, and streamed through the server.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { proxyFile } from '../live/proxy.js';
import { LiveStreamError } from '../live/relay.js';
import { LiveService } from '../live/service.js';
import { VodService } from '../live/vod-service.js';
import { HlsError } from '../playback/hls.js';
import {
  CatalogQuery,
  ErrorResponse,
  IptvMovie,
  IptvMoviePage,
  IptvSeriesDetail,
  IptvSeriesPage,
  LiveCategory,
} from '../schemas/index.js';

export const liveVodRoutes: FastifyPluginAsyncZod = async (app) => {
  const vod = new VodService(app.db);
  const live = new LiveService(app.db);
  const sec = { security: [{ bearerAuth: [] }], tags: ['live'] };
  const NAMES = {
    404: 'Not Found',
    501: 'Not Implemented',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
  } as const;
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HlsError || error instanceof LiveStreamError)
      return reply
        .code(error.statusCode)
        .send({
          statusCode: error.statusCode,
          error: NAMES[error.statusCode],
          message: error.message,
        });
    throw error;
  });
  const streamSchema = {
    params: z.object({ id: z.string() }),
    querystring: z.object({ access_token: z.string().optional() }),
    response: { 404: ErrorResponse, 502: ErrorResponse, 503: ErrorResponse },
  };

  app.get(
    '/vod/categories',
    {
      schema: { ...sec, summary: 'IPTV movie categories', response: { 200: LiveCategory.array() } },
    },
    async () => live.categories('vod'),
  );

  app.get(
    '/vod',
    {
      schema: {
        ...sec,
        summary: 'IPTV movies, paged',
        querystring: CatalogQuery,
        response: { 200: IptvMoviePage },
      },
    },
    async (request) => ({ ...vod.movies(request.query), offset: request.query.offset }),
  );

  app.get(
    '/vod/:id',
    {
      schema: {
        ...sec,
        summary: 'One IPTV movie',
        params: z.object({ id: z.string() }),
        response: { 200: IptvMovie, 404: ErrorResponse },
      },
    },
    async (request, reply) => vod.movie(request.params.id) ?? reply.notFound('No such movie'),
  );

  app.get(
    '/vod/:id/stream',
    {
      schema: {
        ...sec,
        summary: 'The movie file, passed through from the provider with byte ranges',
        description:
          'Send `Range` to seek. Players that cannot set headers may pass `?access_token=`.',
        ...streamSchema,
      },
    },
    async (request, reply) => {
      const movie = vod.movie(request.params.id);
      if (!movie) return reply.notFound('No such movie');
      const client = app.live.client();
      if (!client) throw new LiveStreamError(503, 'IPTV credentials are not set');
      await proxyFile(
        request,
        reply,
        client.vodUrl(movie.id, movie.containerExtension),
        movie.containerExtension,
        app.httpFetch,
      );
    },
  );

  app.get(
    '/series/categories',
    {
      schema: {
        ...sec,
        summary: 'IPTV series categories',
        response: { 200: LiveCategory.array() },
      },
    },
    async () => live.categories('series'),
  );

  app.get(
    '/series',
    {
      schema: {
        ...sec,
        summary: 'IPTV series, paged',
        querystring: CatalogQuery,
        response: { 200: IptvSeriesPage },
      },
    },
    async (request) => ({ ...vod.series(request.query), offset: request.query.offset }),
  );

  app.get(
    '/series/:id',
    {
      schema: {
        ...sec,
        summary: 'One IPTV series with its seasons and episodes',
        description:
          'Episodes are pulled from the provider on first open and refreshed after a day.',
        params: z.object({ id: z.string() }),
        response: { 200: IptvSeriesDetail, 404: ErrorResponse },
      },
    },
    async (request, reply) =>
      (await vod.seriesDetail(request.params.id, app.live.client())) ??
      reply.notFound('No such series'),
  );

  app.get(
    '/series/episodes/:id/stream',
    {
      schema: {
        ...sec,
        summary: 'The episode file, passed through from the provider with byte ranges',
        ...streamSchema,
      },
    },
    async (request, reply) => {
      const found = vod.episode(request.params.id);
      if (!found) return reply.notFound('No such episode');
      const client = app.live.client();
      if (!client) throw new LiveStreamError(503, 'IPTV credentials are not set');
      const ext = found.episode.containerExtension;
      await proxyFile(
        request,
        reply,
        client.seriesEpisodeUrl(found.episode.id, ext),
        ext,
        app.httpFetch,
      );
    },
  );
};
