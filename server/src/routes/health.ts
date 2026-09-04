import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

export const HealthResponse = z
  .object({ status: z.literal('ok'), version: z.string(), time: z.string() })
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
    async () => ({ status: 'ok' as const, version: opts.version, time: new Date().toISOString() }),
  );
};
