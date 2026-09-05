import fastify, { type FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Config } from './config.js';
import { openDatabase, type Db } from './db/index.js';
import { authPlugin } from './auth/plugin.js';
import { authRoutes } from './routes/auth.js';
import { ScanRunner } from './library/scan-runner.js';
import { LibraryWatcher } from './library/watcher.js';
import { ImageStore } from './images/store.js';
import { LiveHlsManager } from './live/live-hls.js';
import { LiveRefresher } from './live/refresher.js';
import { ProviderMatcher } from './live/provider-matcher.js';
import { RecordingManager } from './live/recorder.js';
import { LiveService } from './live/service.js';
import { backfillStreamDepth } from './media/probe-service.js';
import { LiveRelayManager } from './live/relay.js';
import { detectHardware, type HardwareReport } from './playback/hardware.js';
import { HlsManager } from './playback/hls.js';
import { TmdbClient } from './metadata/tmdb.js';
import { SessionRegistry } from './playback/sessions.js';
import { SettingsService } from './settings/service.js';
import { filesRoutes } from './routes/files.js';
import { healthRoutes } from './routes/health.js';
import { imagesRoutes } from './routes/images.js';
import { itemsRoutes } from './routes/items.js';
import { librariesRoutes } from './routes/libraries.js';
import { liveRoutes } from './routes/live.js';
import { liveVodRoutes } from './routes/live-vod.js';
import { recordingsRoutes } from './routes/recordings.js';
import { playbackRoutes } from './routes/playback.js';
import { progressRoutes } from './routes/progress.js';
import { settingsRoutes } from './routes/settings.js';
import { subtitlesRoutes } from './routes/subtitles.js';
import { usersRoutes } from './routes/users.js';
// Registers schema ids so every named schema appears under components.
import './schemas/index.js';

/** Frozen at 1.0.0 for the v1 clients. Changes from here are additive only (see docs/API.md). */
export const API_VERSION = '1.0.0';

export type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>;

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Db;
    /** Outbound HTTP for TMDB, AniList, and artwork. Injectable so tests never hit the network. */
    httpFetch: HttpFetch;
    scans: ScanRunner;
    watcher: LibraryWatcher;
    playback: SessionRegistry;
    hls: HlsManager;
    hardware: HardwareReport;
    live: LiveRefresher;
    liveRelays: LiveRelayManager;
    liveHls: LiveHlsManager;
    iptvMatcher: ProviderMatcher;
    recorder: RecordingManager;
  }
}

export interface AppOptions {
  config: Config;
  logger?: boolean;
  fetch?: HttpFetch;
  /** Test hooks: how long a live relay stays open with no viewers, and the HLS file wait. */
  liveGraceMs?: number;
  hlsWaitMs?: number;
  /** Scheduler period for recordings; tests use a short one. */
  recordingTickMs?: number;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = fastify({
    logger: options.logger ? { level: options.config.logLevel } : false,
    // Shutdown must not wait for live viewers to leave; their streams are cut with the server.
    forceCloseConnections: true,
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // Generated clients (the Kotlin one included) send body-less POSTs with a JSON content type
  // and an empty body; Fastify's default parser rejects that with 400. Treat empty as no body.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (text.trim() === '') return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch (error) {
      const err = error as Error & { statusCode?: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  const database = openDatabase(options.config.dbPath);
  app.decorate('config', options.config);
  app.decorate('db', database.db);
  app.decorate('httpFetch', options.fetch ?? ((url, init) => fetch(url, init)));
  const scans = new ScanRunner(app, app.log);
  const watcher = new LibraryWatcher(database.db, scans, app.log, {
    debounceMs: options.config.scanDebounceMs,
  });
  app.decorate('scans', scans);
  const playback = new SessionRegistry();
  app.decorate('playback', playback);
  app.decorate(
    'hls',
    new HlsManager(options.config, playback, app.log, {
      idleMs: options.config.hlsIdleMs,
      maxProcesses: options.config.hlsMaxProcesses,
      maxTranscodes: options.config.hlsMaxTranscodes,
      seekAheadSegments: options.config.hlsSeekAheadSegments,
      // Replaced by the self-test result in onReady.
      hardware: null,
      vaapiDevice: options.config.vaapiDevice,
      waitMs: 20_000,
    }),
  );
  app.decorate('watcher', watcher);
  app.decorate('hardware', { encoder: null, reason: 'not probed yet' } as HardwareReport);
  app.decorate(
    'live',
    new LiveRefresher(
      database.db,
      new SettingsService(database.db),
      app.log,
      options.config.iptvUrl,
      options.fetch,
    ),
  );
  app.decorate(
    'liveRelays',
    new LiveRelayManager(app.live, app.log, {
      maxStreams: options.config.liveMaxStreams,
      graceMs: options.liveGraceMs ?? 5000,
      fetcher: options.fetch,
    }),
  );
  app.decorate(
    'liveHls',
    new LiveHlsManager(options.config, app.liveRelays, app.log, {
      idleMs: options.config.hlsIdleMs,
      waitMs: options.hlsWaitMs ?? 20_000,
    }),
  );
  app.decorate(
    'iptvMatcher',
    new ProviderMatcher({
      db: database.db,
      images: new ImageStore(options.config.imagesDir, options.fetch ?? fetch),
      tmdb: () => {
        const key = new SettingsService(database.db).get('tmdb.apiKey');
        return key ? new TmdbClient(key, options.fetch ?? fetch) : null;
      },
      log: app.log,
    }),
  );
  app.live.afterRefresh = () => void app.iptvMatcher.matchPending();
  app.decorate(
    'recorder',
    new RecordingManager(
      database.db,
      options.config,
      app.liveRelays,
      new LiveService(database.db),
      app.log,
      {
        tickMs: options.recordingTickMs ?? 5_000,
        paddingMs: options.config.recordingPaddingMs,
      },
    ),
  );
  app.addHook('onReady', async () => {
    app.hardware = await detectHardware(options.config, app.log);
    app.hls.setHardware(app.hardware.encoder);
    if (options.config.watchLibraries) await watcher.startAll();
    if (options.config.liveRefresh) app.live.start();
    app.recorder.start();
    backfillStreamDepth(database.db, app.log);
  });
  app.addHook('onClose', async () => {
    app.live.stop();
    await app.recorder.close();
    await app.liveHls.close();
    await app.liveRelays.close();
    await app.hls.close();
    await watcher.close();
    await scans.whenIdle();
    database.close();
  });

  await app.register(sensible);
  // Registered with global: false so only routes that set config.rateLimit are limited.
  await app.register(rateLimit, { global: false });
  await app.register(authPlugin);
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Projektor API',
        description: 'Self-hosted media server for movies, TV shows, and anime.',
        version: API_VERSION,
      },
      servers: [{ url: '/' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
        },
      },
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  });

  await app.register(
    async (api) => {
      await api.register(healthRoutes, { version: API_VERSION });
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(librariesRoutes, { prefix: '/libraries' });
      await api.register(itemsRoutes, { prefix: '/items' });
      await api.register(imagesRoutes, { prefix: '/images' });
      await api.register(settingsRoutes, { prefix: '/settings' });
      await api.register(filesRoutes, { prefix: '/files' });
      await api.register(playbackRoutes, { prefix: '/playback' });
      await api.register(subtitlesRoutes, { prefix: '/subtitles' });
      await api.register(progressRoutes, { prefix: '/progress' });
      await api.register(usersRoutes, { prefix: '/users' });
      await api.register(liveRoutes, { prefix: '/live' });

      await api.register(liveVodRoutes, { prefix: '/live' });

      await api.register(recordingsRoutes, { prefix: '/recordings' });
    },
    { prefix: '/api' },
  );

  // Serve the built web app when configured: static assets, then index.html for any other
  // non-API path so client-side routes deep-link correctly.
  if (options.config.webDist && existsSync(path.join(options.config.webDist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: options.config.webDist,
      prefix: '/',
      wildcard: false,
      index: ['index.html'],
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/') || request.method !== 'GET') {
        return reply.code(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: `Route ${request.method}:${request.url} not found`,
        });
      }
      return reply.type('text/html').sendFile('index.html');
    });
    app.log.info({ webDist: options.config.webDist }, 'serving web app');
  }

  return app;
}
