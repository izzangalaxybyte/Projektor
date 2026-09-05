import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { makeTestConfig } from './test-utils.js';

let app: FastifyInstance;
const t = makeTestConfig();
beforeAll(async () => {
  app = await buildApp({ config: t.config });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  t.cleanup();
});

describe('API contract', () => {
  it('matches the committed openapi.json (run `pnpm emit-openapi` and `pnpm generate` after schema changes)', () => {
    const committed = JSON.parse(
      readFileSync(
        path.resolve(import.meta.dirname, '../../packages/api-contract/openapi.json'),
        'utf8',
      ),
    ) as unknown;
    expect(app.swagger()).toEqual(committed);
  });

  it('is version 1.0.0 with every route tagged and secured or explicitly public', () => {
    const doc = app.swagger();
    if (!('openapi' in doc)) throw new Error('expected OpenAPI 3');
    expect(doc.info.version).toBe('1.0.0');
    const publicRoutes = [
      '/api/health',
      '/api/auth/setup',
      '/api/auth/profiles',
      '/api/auth/login',
      '/api/images/{key}',
    ];
    for (const [route, ops] of Object.entries(doc.paths ?? {})) {
      for (const [method, op] of Object.entries(
        ops as Record<string, { tags?: string[]; security?: unknown[] }>,
      )) {
        expect(op.tags?.length, `${method} ${route} has tags`).toBeGreaterThan(0);
        if (!publicRoutes.includes(route))
          expect(op.security, `${method} ${route} declares bearerAuth`).toBeDefined();
      }
    }
  });
});
