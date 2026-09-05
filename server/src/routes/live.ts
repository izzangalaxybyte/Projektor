import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { LiveStreamError } from '../live/relay.js';
import { LiveService } from '../live/service.js';
import { HlsError, withToken } from '../playback/hls.js';
import {
  ErrorResponse,
  GuideQuery,
  LiveCategory,
  LiveChannel,
  LiveDecideRequest,
  LivePlaybackDecision,
  LiveProgramme,
  LiveStatus,
} from '../schemas/index.js';

export const liveRoutes: FastifyPluginAsyncZod = async (app) => {
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
    if (error instanceof HlsError || error instanceof LiveStreamError) {
      return reply
        .code(error.statusCode)
        .send({
          statusCode: error.statusCode,
          error: NAMES[error.statusCode],
          message: error.message,
        });
    }
    throw error;
  });

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

  app.post(
    '/decide',
    {
      schema: {
        ...sec,
        summary: 'Choose a raw TS relay or live HLS for a channel and device profile',
        description:
          'Profiles that list the `ts` container get the relay URL. Others get a live HLS session: video copied, audio as stereo AAC.',
        body: LiveDecideRequest,
        response: { 200: LivePlaybackDecision, 404: ErrorResponse, 503: ErrorResponse },
      },
    },
    async (request, reply) => {
      const channel = live.channel(request.body.channelId);
      if (!channel) return reply.notFound('No such channel');
      if (!app.live.credentials()) throw new LiveStreamError(503, 'IPTV credentials are not set');
      if (request.body.profile.containers.includes('ts')) {
        return {
          method: 'direct' as const,
          url: `/api/live/channels/${channel.id}/stream`,
          sessionId: null,
          reason: 'device plays MPEG-TS',
        };
      }
      const session = app.liveHls.create(channel.id);
      return {
        method: 'hls' as const,
        url: `/api/live/sessions/${session.id}/index.m3u8`,
        sessionId: session.id,
        reason: 'device needs HLS; video copied, audio to AAC',
      };
    },
  );

  app.get(
    '/channels/:id/stream',
    {
      schema: {
        ...sec,
        summary: "The channel's MPEG-TS stream, relayed from the provider",
        description:
          'One provider connection per channel is shared by every viewer and closes shortly after the last one leaves. Players that cannot set headers may pass `?access_token=`.',
        params: z.object({ id: z.string() }),
        querystring: z.object({ access_token: z.string().optional() }),
        response: { 404: ErrorResponse, 502: ErrorResponse, 503: ErrorResponse },
      },
    },
    async (request, reply) => {
      const channel = live.channel(request.params.id);
      if (!channel) return reply.notFound('No such channel');
      const headers = { 'content-type': 'video/mp2t', 'cache-control': 'no-store' };
      if (request.method === 'HEAD') {
        reply.hijack();
        reply.raw.writeHead(200, headers);
        reply.raw.end();
        return;
      }
      const sub = app.liveRelays.subscribe(channel.id);
      try {
        await sub.ready;
      } catch (error) {
        sub.close();
        throw error;
      }
      reply.hijack();
      reply.raw.writeHead(200, headers);
      sub.stream.pipe(reply.raw);
      const stop = () => {
        sub.close();
        sub.stream.unpipe(reply.raw);
        reply.raw.end();
      };
      request.raw.on('close', stop);
      reply.raw.on('error', stop);
    },
  );

  app.get(
    '/sessions/:id/:name',
    {
      schema: {
        ...sec,
        summary: 'Live HLS playlist or segment',
        description:
          '`index.m3u8` is a sliding window of the last six 4-second segments; `seg-N.ts` are the segments. The first request starts ffmpeg.',
        params: z.object({ id: z.string(), name: z.string() }),
        querystring: z.object({ access_token: z.string().optional() }),
        response: {
          404: ErrorResponse,
          502: ErrorResponse,
          503: ErrorResponse,
          504: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const session = app.liveHls.session(request.params.id);
      const body = await app.liveHls.awaitFile(session, request.params.name);
      reply
        .header('content-type', app.liveHls.contentType(request.params.name))
        .header('cache-control', 'no-store');
      if (request.params.name.endsWith('.m3u8'))
        return reply.send(withToken(body.toString('utf8'), request.query.access_token) as never);
      return reply.send(body as never);
    },
  );

  app.delete(
    '/sessions/:id',
    {
      schema: {
        ...sec,
        summary: 'Stop a live HLS session',
        params: z.object({ id: z.string() }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await app.liveHls.stop(request.params.id);
      return reply.code(204).send(null);
    },
  );
};
