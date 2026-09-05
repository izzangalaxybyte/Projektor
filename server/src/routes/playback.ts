import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { schema } from '../db/index.js';
import { decide } from '../playback/decision.js';
import { ErrorResponse, PlaybackDecideRequest, PlaybackDecision } from '../schemas/index.js';

export const playbackRoutes: FastifyPluginAsyncZod = async (app) => {
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
};
