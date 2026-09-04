import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { HealthResponse } from './routes/health.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(() => app.close());

describe('GET /api/health', () => {
  it('returns a valid health payload', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(HealthResponse.safeParse(res.json()).success).toBe(true);
  });
});

describe('OpenAPI document', () => {
  it('includes the health route and a bearer security scheme', () => {
    const doc = app.swagger();
    if (!('openapi' in doc)) throw new Error('expected an OpenAPI 3 document');
    expect(doc.paths?.['/api/health']?.get).toBeDefined();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.components?.securitySchemes?.['bearerAuth']).toBeDefined();
    expect(doc.components?.schemas?.['PlaybackDecision']).toBeDefined();
  });
});
