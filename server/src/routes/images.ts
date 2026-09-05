import { createReadStream } from 'node:fs';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { IMAGE_WIDTHS, ImageStore } from '../images/store.js';

export const imagesRoutes: FastifyPluginAsyncZod = async (app) => {
  const store = new ImageStore(app.config.imagesDir);

  app.get(
    '/:key',
    {
      // Images are embedded in <img> tags, which cannot send headers; the key is an unguessable
      // hash of the source URL and artwork is not sensitive, so this route is public.
      config: { public: true },
      schema: {
        tags: ['images'],
        summary: 'Cached artwork, optionally resized',
        params: z.object({ key: z.string().regex(/^[a-f0-9]{40}$/) }),
        querystring: z.object({
          w: z.coerce
            .number()
            .pipe(
              z.union(
                IMAGE_WIDTHS.map((w) => z.literal(w)) as [
                  z.ZodLiteral<300>,
                  z.ZodLiteral<780>,
                  z.ZodLiteral<1280>,
                ],
              ),
            )
            .optional(),
        }),
      },
    },
    async (request, reply) => {
      const file = await store.resolve(request.params.key, request.query.w ?? null);
      if (!file) return reply.notFound('No such image');
      return reply
        .header('content-type', 'image/jpeg')
        .header('cache-control', 'public, max-age=31536000, immutable')
        .send(createReadStream(file));
    },
  );
};
