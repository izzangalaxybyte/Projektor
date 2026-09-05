import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ErrorResponse, SettingsUpdate, SettingsView } from '../schemas/index.js';
import { SettingsService } from '../settings/service.js';

export const settingsRoutes: FastifyPluginAsyncZod = async (app) => {
  const settings = new SettingsService(app.db);
  const view = () => ({
    tmdbApiKey: settings.masked('tmdb.apiKey'),
    openSubtitlesApiKey: settings.masked('opensubtitles.apiKey'),
    openSubtitlesUsername: settings.get('opensubtitles.username'),
    openSubtitlesPassword: settings.masked('opensubtitles.password'),
  });

  app.get(
    '/',
    {
      prefixTrailingSlash: 'no-slash',
      preHandler: app.requireAdmin,
      schema: {
        tags: ['settings'],
        summary: 'Server settings (admin). Secrets are masked.',
        security: [{ bearerAuth: [] }],
        response: { 200: SettingsView, 403: ErrorResponse },
      },
    },
    async () => view(),
  );

  app.patch(
    '/',
    {
      prefixTrailingSlash: 'no-slash',
      preHandler: app.requireAdmin,
      schema: {
        tags: ['settings'],
        summary: 'Update settings (admin)',
        security: [{ bearerAuth: [] }],
        body: SettingsUpdate,
        response: { 200: SettingsView, 403: ErrorResponse },
      },
    },
    async (request) => {
      const b = request.body;
      if (b.tmdbApiKey !== undefined) settings.set('tmdb.apiKey', b.tmdbApiKey?.trim() ?? null);
      if (b.openSubtitlesApiKey !== undefined)
        settings.set('opensubtitles.apiKey', b.openSubtitlesApiKey?.trim() ?? null);
      if (b.openSubtitlesUsername !== undefined)
        settings.set('opensubtitles.username', b.openSubtitlesUsername?.trim() ?? null);
      if (b.openSubtitlesPassword !== undefined)
        settings.set('opensubtitles.password', b.openSubtitlesPassword ?? null);
      return view();
    },
  );
};
