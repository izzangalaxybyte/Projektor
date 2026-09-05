import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AuthError } from '../auth/service.js';
import {
  ErrorResponse,
  Id,
  LoginRequest,
  LoginResponse,
  Profile,
  Session,
  SetupRequest,
  SetupStatus,
} from '../schemas/index.js';

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AuthError) {
      const names = { 401: 'Unauthorized', 409: 'Conflict', 423: 'Locked' } as const;
      return reply.code(error.statusCode).send({
        statusCode: error.statusCode,
        error: names[error.statusCode],
        message: error.message,
      });
    }
    throw error;
  });

  app.get(
    '/setup',
    {
      config: { public: true },
      schema: {
        tags: ['auth'],
        summary: 'Whether the first admin profile still needs creating',
        response: { 200: SetupStatus },
      },
    },
    async () => ({ needsSetup: app.auth.needsSetup() }),
  );

  app.post(
    '/setup',
    {
      config: { public: true },
      schema: {
        tags: ['auth'],
        summary: 'Create the first admin profile and log it in',
        body: SetupRequest,
        response: { 200: LoginResponse, 409: ErrorResponse },
      },
    },
    async (request) => {
      const profile = await app.auth.setup(request.body.name, request.body.pin);
      const { token } = await app.auth.login(profile.id, request.body.pin, 'Setup');
      return { token, profile };
    },
  );

  app.get(
    '/profiles',
    {
      config: { public: true },
      schema: {
        tags: ['auth'],
        summary: 'Profiles to pick from on the login screen',
        response: { 200: Profile.array() },
      },
    },
    async () => app.auth.listProfiles(),
  );

  app.post(
    '/login',
    {
      config: {
        public: true,
        rateLimit: { max: 20, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['auth'],
        summary: 'Exchange a profile id and PIN for a bearer token',
        body: LoginRequest,
        response: {
          200: LoginResponse,
          401: ErrorResponse,
          423: ErrorResponse,
          429: ErrorResponse,
        },
      },
    },
    async (request) => {
      const { token, user } = await app.auth.login(
        request.body.profileId,
        request.body.pin,
        request.body.deviceName,
      );
      return { token, profile: user };
    },
  );

  app.get(
    '/me',
    {
      schema: {
        tags: ['auth'],
        summary: 'The profile behind the current token',
        security: [{ bearerAuth: [] }],
        response: { 200: Profile },
      },
    },
    async (request) => request.user!,
  );

  app.post(
    '/logout',
    {
      schema: {
        tags: ['auth'],
        summary: 'Revoke the current token',
        security: [{ bearerAuth: [] }],
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      app.auth.revokeSession(request.user!.id, request.session!.id);
      return reply.code(204).send(null);
    },
  );

  app.get(
    '/sessions',
    {
      schema: {
        tags: ['auth'],
        summary: 'Devices logged in to this profile',
        security: [{ bearerAuth: [] }],
        response: { 200: Session.array() },
      },
    },
    async (request) =>
      app.auth.listSessions(request.user!.id).map((s) => ({
        id: s.id,
        deviceName: s.deviceName,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        current: s.id === request.session!.id,
      })),
  );

  app.delete(
    '/sessions/:id',
    {
      schema: {
        tags: ['auth'],
        summary: 'Log out another device',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: Id }),
        response: { 204: z.null(), 404: ErrorResponse },
      },
    },
    async (request, reply) => {
      if (!app.auth.revokeSession(request.user!.id, request.params.id))
        return reply.notFound('No such session');
      return reply.code(204).send(null);
    },
  );
};
