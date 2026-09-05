import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '../db/index.js';
import { ErrorResponse, Id, Pin, Profile } from '../schemas/index.js';

export const CreateUserRequest = z
  .object({ name: z.string().min(1).max(40), pin: Pin, isAdmin: z.boolean().default(false) })
  .meta({ id: 'CreateUserRequest' });

/** Admin management of household profiles. */
export const usersRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      prefixTrailingSlash: 'no-slash',
      preHandler: app.requireAdmin,
      schema: {
        tags: ['users'],
        summary: 'All profiles (admin)',
        security: [{ bearerAuth: [] }],
        response: { 200: Profile.array(), 403: ErrorResponse },
      },
    },
    async () => app.auth.listProfiles(),
  );

  app.post(
    '/',
    {
      prefixTrailingSlash: 'no-slash',
      preHandler: app.requireAdmin,
      schema: {
        tags: ['users'],
        summary: 'Create a profile (admin)',
        security: [{ bearerAuth: [] }],
        body: CreateUserRequest,
        response: { 201: Profile, 403: ErrorResponse },
      },
    },
    async (request, reply) =>
      reply
        .code(201)
        .send(await app.auth.createUser(request.body.name, request.body.pin, request.body.isAdmin)),
  );

  app.delete(
    '/:id',
    {
      preHandler: app.requireAdmin,
      schema: {
        tags: ['users'],
        summary:
          'Delete a profile and its sessions and watch state (admin). You cannot delete yourself.',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: Id }),
        response: { 204: z.null(), 400: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (request, reply) => {
      if (request.params.id === request.user!.id)
        return reply.badRequest('You cannot delete the profile you are signed in with');
      const result = app.db
        .delete(schema.users)
        .where(eq(schema.users.id, request.params.id))
        .run();
      if (result.changes === 0) return reply.notFound('No such profile');
      return reply.code(204).send(null);
    },
  );
};
