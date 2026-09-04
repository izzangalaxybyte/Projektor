import fastify, { type FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import sensible from '@fastify/sensible';
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { healthRoutes } from './routes/health.js';
// Registers schema ids so every named schema appears under components.
import './schemas/index.js';

export const API_VERSION = '0.0.0';

export interface AppOptions {
  logger?: boolean;
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = fastify({ logger: options.logger ?? false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(sensible);
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
    },
    { prefix: '/api' },
  );

  return app;
}
