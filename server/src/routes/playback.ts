import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { schema } from '../db/index.js';
import { decide } from '../playback/decision.js';
import { HlsError } from '../playback/hls.js';
import { z } from 'zod';
import { ErrorResponse, Id, PlaybackDecideRequest, PlaybackDecision } from '../schemas/index.js';

export const playbackRoutes: FastifyPluginAsyncZod = async (app) => {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HlsError) {
      const names = {
        404: 'Not Found',
        501: 'Not Implemented',
        503: 'Service Unavailable',
        504: 'Gateway Timeout',
      } as const;
      return reply.code(error.statusCode).send({
        statusCode: error.statusCode,
        error: names[error.statusCode],
        message: error.message,
      });
    }
    throw error;
  });

  app.post(
    '/decide',
    {
      schema: {
        tags: ['playback'],
        summary: 'Choose direct play, remux, or transcode for a file and device profile',
        description:
          'Direct play returns the file URL. Remux and transcode create an HLS session and return its master playlist URL.',
        security: [{ bearerAuth: [] }],
        body: PlaybackDecideRequest,
        response: { 200: PlaybackDecision, 404: ErrorResponse },
      },
    },
    async (request, reply) => {
      const file = app.db
        .select()
        .from(schema.mediaFiles)
        .where(eq(schema.mediaFiles.id, request.body.fileId))
        .get();
      if (!file || file.missing) return reply.notFound('No such file');
      const streams = app.db
        .select()
        .from(schema.streams)
        .where(eq(schema.streams.fileId, file.id))
        .orderBy(asc(schema.streams.streamIndex))
        .all();
      const decision = decide(
        {
          container: file.container,
          bitrate: file.bitrate,
          streams: streams.map((s) => ({
            index: s.streamIndex,
            type: s.type,
            codec: s.codec,
            width: s.width,
            height: s.height,
            channels: s.channels,
            isDefault: s.isDefault,
            language: s.language,
          })),
        },
        request.body.profile,
        { audioStreamIndex: request.body.audioStreamIndex },
      );
      const base = {
        method: decision.method,
        video: decision.video,
        audio: decision.audio,
        reason: decision.reasons.join('; '),
        subtitleUrls: [],
      };
      if (decision.method === 'direct') {
        return { ...base, url: `/api/files/${file.id}/stream`, sessionId: null };
      }
      const session = app.playback.create({
        fileId: file.id,
        filePath: file.path,
        durationMs: file.durationMs ?? 0,
        profile: request.body.profile,
        decision,
        startPositionMs: request.body.startPositionMs,
      });
      return {
        ...base,
        url: `/api/playback/sessions/${session.id}/master.m3u8`,
        sessionId: session.id,
      };
    },
  );

  const sessionParams = z.object({ id: Id });
  const hlsSecurity = { security: [{ bearerAuth: [] }], tags: ['playback'] };

  app.get(
    '/sessions/:id/master.m3u8',
    {
      schema: {
        ...hlsSecurity,
        summary: 'HLS master playlist for a session',
        params: sessionParams,
        querystring: z.object({ access_token: z.string().optional() }),
        response: { 404: ErrorResponse },
      },
    },
    async (request, reply) => {
      const session = app.hls.session(request.params.id);
      return reply
        .header('content-type', 'application/vnd.apple.mpegurl')
        .header('cache-control', 'no-store')
        .send(app.hls.masterPlaylist(session) as never);
    },
  );

  app.get(
    '/sessions/:id/:name',
    {
      schema: {
        ...hlsSecurity,
        summary: 'HLS media playlist, init segment, or media segment',
        description:
          'Starts ffmpeg on first request and waits up to 20 seconds for the requested file.',
        params: sessionParams.extend({
          name: z.string().regex(/^(index\.m3u8|init\.mp4|seg-\d+\.(ts|m4s))$/),
        }),
        querystring: z.object({ access_token: z.string().optional() }),
        response: {
          404: ErrorResponse,
          501: ErrorResponse,
          503: ErrorResponse,
          504: ErrorResponse,
        },
      },
    },
    async (request, reply) => {
      const session = app.hls.session(request.params.id);
      const body = await app.hls.awaitFile(session, request.params.name);
      return reply
        .header('content-type', app.hls.contentType(request.params.name))
        .header('cache-control', 'no-store')
        .send(body as never);
    },
  );

  app.delete(
    '/sessions/:id',
    {
      schema: {
        ...hlsSecurity,
        summary: 'Stop a session and delete its segments',
        params: sessionParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await app.hls.stop(request.params.id);
      return reply.code(204).send(null);
    },
  );
};
