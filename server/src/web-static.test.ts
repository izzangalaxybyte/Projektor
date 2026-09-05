import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { configForDataDir } from './config.js';
import { makeTestConfig } from './test-utils.js';

const t = makeTestConfig();
let app: FastifyInstance;
beforeAll(async () => {
  const dist = path.join(t.config.dataDir, 'dist');
  mkdirSync(path.join(dist, 'assets'), { recursive: true });
  writeFileSync(
    path.join(dist, 'index.html'),
    '<!doctype html><title>Projektor</title><div id="root"></div>',
  );
  writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log(1)');
  app = await buildApp({
    config: configForDataDir(t.config.dataDir, {
      logLevel: 'fatal',
      watchLibraries: false,
      webDist: dist,
    }),
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  t.cleanup();
});

describe('web app serving', () => {
  it('serves index, assets, and falls back to index for client routes but not for the API', async () => {
    expect((await app.inject({ method: 'GET', url: '/' })).body).toContain('Projektor');
    expect((await app.inject({ method: 'GET', url: '/assets/app.js' })).body).toBe(
      'console.log(1)',
    );
    const deep = await app.inject({ method: 'GET', url: '/movies/abc' });
    expect(deep.statusCode).toBe(200);
    expect(deep.headers['content-type']).toContain('text/html');
    // Unknown API paths never get the HTML fallback: the auth hook answers first, JSON either way.
    const apiMiss = await app.inject({ method: 'GET', url: '/api/nope' });
    expect([401, 404]).toContain(apiMiss.statusCode);
    expect(apiMiss.headers['content-type']).toContain('application/json');
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
  });
});
