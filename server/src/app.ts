import fastify, { type FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
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
import { healthRoutes } from './routes/health.js';
import { imagesRoutes } from './routes/images.js';
import { itemsRoutes } from './routes/items.js';
import { librariesRoutes } from './routes/libraries.js';
import { settingsRoutes } from './routes/settings.js';
// Registers schema ids so every named schema appears under components.
import './schemas/index.js';

export const API_VERSION = '0.0.0';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Db;
  }
}

export interface AppOptions {
  config: Config;
  logger?: boolean;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = fastify({
    logger: options.logger ? { level: options.config.logLevel } : false,
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const database = openDatabase(options.config.dbPath);
  app.decorate('config', options.config);
  app.decorate('db', database.db);
  app.addHook('onClose', () => database.close());

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
    },
    { prefix: '/api' },
  );

  return app;
}
