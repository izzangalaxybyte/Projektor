import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { LibraryError, LibraryService } from '../library/service.js';
import { CreateLibraryRequest, ErrorResponse, Id, Library, ScanStatus } from '../schemas/index.js';

export const librariesRoutes: FastifyPluginAsyncZod = async (app) => {
  const libraries = new LibraryService(app.db);
  const params = z.object({ id: Id });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof LibraryError) {
      return reply.code(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.statusCode === 404 ? 'Not Found' : 'Bad Request',
        message: error.message,
      });
    }
    throw error;
  });

  app.get(
    '/',
    {
      prefixTrailingSlash: 'no-slash',
      schema: {
        tags: ['libraries'],
        summary: 'List libraries',
        security: [{ bearerAuth: [] }],
        response: { 200: Library.array() },
      },
    },
    async () => libraries.list(),
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['libraries'],
        summary: 'Get a library',
        security: [{ bearerAuth: [] }],
        params,
        response: { 200: Library, 404: ErrorResponse },
      },
    },
    async (request) => libraries.get(request.params.id),
  );

  app.post(
    '/',
    {
      prefixTrailingSlash: 'no-slash',
      preHandler: app.requireAdmin,
      schema: {
        tags: ['libraries'],
        summary: 'Create a library (admin)',
        security: [{ bearerAuth: [] }],
        body: CreateLibraryRequest,
        response: { 201: Library, 400: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (request, reply) => {
      const library = await libraries.create(request.body);
      if (app.config.watchLibraries) await app.watcher.watch(library.id);
      return reply.code(201).send(library);
    },
  );

  app.delete(
    '/:id',
    {
      preHandler: app.requireAdmin,
      schema: {
        tags: ['libraries'],
        summary: 'Delete a library and everything indexed from it (admin)',
        security: [{ bearerAuth: [] }],
        params,
        response: { 204: z.null(), 403: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (request, reply) => {
      await app.watcher.unwatch(request.params.id);
      libraries.delete(request.params.id);
      return reply.code(204).send(null);
    },
  );

  app.post(
    '/:id/scan',
    {
      preHandler: app.requireAdmin,
      schema: {
        tags: ['libraries'],
        summary: 'Queue a scan of this library (admin)',
        description:
          'Returns immediately with the current status. Poll GET /libraries/{id}/scan until state is idle.',
        security: [{ bearerAuth: [] }],
        params,
        response: { 202: ScanStatus, 403: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (request, reply) => {
      libraries.get(request.params.id);
      return reply.code(202).send(app.scans.request(request.params.id, 'manual'));
    },
  );

  app.get(
    '/:id/scan',
    {
      schema: {
        tags: ['libraries'],
        summary: 'Status of the latest scan of this library',
        security: [{ bearerAuth: [] }],
        params,
        response: { 200: ScanStatus, 404: ErrorResponse },
      },
    },
    async (request) => {
      libraries.get(request.params.id);
      return app.scans.statusOf(request.params.id);
    },
  );
};
