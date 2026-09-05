import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { scanLibrary } from '../library/scanner.js';
import { identifyFiles } from '../identify/identifier.js';
import { probeFiles } from '../media/probe-service.js';
import { metadataDeps } from '../metadata/deps.js';
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
      const probed = await probeFiles(app.db, result.changedFileIds, {
        ffprobePath: app.config.ffprobePath,
        log: request.log,
      });
      const identified = identifyFiles(app.db, result.changedFileIds, request.log);
      const deps = metadataDeps(app, request.log);
      const matched = deps.matcher
        ? await deps.matcher.matchPending()
        : { matched: 0, unmatched: 0, failed: 0 };
      const anime = await deps.animeMatcher.matchPending();
      return {
        libraryId: request.params.id,
        state: 'idle' as const,
        itemsLinked: identified.movies + identified.episodes,
        itemsMatched: matched.matched + anime.matched,
        itemsUnmatched: matched.unmatched + anime.unmatched,
        filesSeen: result.filesSeen,
        filesChanged: result.filesChanged,
        filesMissing: result.filesMissing,
        filesProbed: probed.probed,
        filesFailed: probed.failed,
        startedAt,
      };
    },
  );
};
