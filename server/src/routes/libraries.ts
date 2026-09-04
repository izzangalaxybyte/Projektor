import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { scanLibrary } from '../library/scanner.js';
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
    async (request, reply) => reply.code(201).send(await libraries.create(request.body)),
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
        summary: 'Scan a library now (admin). Runs to completion before responding.',
        security: [{ bearerAuth: [] }],
        params,
        response: { 200: ScanStatus, 403: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (request) => {
      libraries.get(request.params.id);
      const startedAt = new Date().toISOString();
      const result = await scanLibrary(app.db, request.params.id, request.log);
      return {
        libraryId: request.params.id,
        state: 'idle' as const,
        filesSeen: result.filesSeen,
        filesChanged: result.filesChanged,
        filesMissing: result.filesMissing,
        startedAt,
      };
    },
  );
};
