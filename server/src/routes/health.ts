import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const HealthResponse = z
  .object({
    status: z.literal('ok'),
    version: z.string(),
    time: z.string(),
    encoder: z
      .enum(['h264_vaapi', 'libx264'])
      .meta({ description: 'Video encoder transcodes will use' }),
    encoderReason: z.string(),
  })
  .meta({ id: 'HealthResponse' });

export const healthRoutes: FastifyPluginAsyncZod<{ version: string }> = async (app, opts) => {
  app.get(
    '/health',
    {
      config: { public: true },
      schema: {
        tags: ['system'],
        summary: 'Liveness check',
        response: { 200: HealthResponse },
      },
    },
    async () => ({
      status: 'ok' as const,
      version: opts.version,
      time: new Date().toISOString(),
      encoder: app.hardware.encoder === 'vaapi' ? ('h264_vaapi' as const) : ('libx264' as const),
      encoderReason: app.hardware.reason,
    }),
  );
};
