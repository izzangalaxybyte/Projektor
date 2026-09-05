import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { configForDataDir } from '../config.js';
import { fixturesDir, setupAdmin } from '../test-utils.js';

const fixtures = fixturesDir();
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'projektor-watch-'));
const mediaDir = path.join(dataDir, 'media');
let app: FastifyInstance;
let headers: Record<string, string>;

beforeAll(async () => {
  mkdirSync(mediaDir, { recursive: true });
  app = await buildApp({
    config: configForDataDir(dataDir, {
      logLevel: 'fatal',
      watchLibraries: true,
      scanDebounceMs: 300,
    }),
  });
  await app.ready();
  headers = { authorization: `Bearer ${(await setupAdmin(app)).token}` };
});
afterAll(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

// Generous: this file runs alongside the ffmpeg-heavy HLS tests.
async function waitFor<T>(probe: () => Promise<T | null>, timeoutMs = 45_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe.skipIf(!existsSync(fixtures))('library watcher', () => {
  it('scans a library on its own when a video file is dropped in, and flags it when removed', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/libraries',
      headers,
      payload: { name: 'Watched', kind: 'movie', paths: [mediaDir] },
    });
    expect(create.statusCode).toBe(201);
    const libraryId = (create.json() as { id: string }).id;

    const target = path.join(mediaDir, 'Dropped Movie (2019).mp4');
    copyFileSync(path.join(fixtures, 'movies/Sample Movie (2019)/Sample Movie (2019).mp4'), target);

    const item = await waitFor(async () => {
      const res = await app.inject({ method: 'GET', url: '/api/items?libraryKind=movie', headers });
      const items = (res.json() as { items: Array<{ title: string; id: string }> }).items;
      return items.find((i) => i.title === 'Dropped Movie') ?? null;
    });
    expect(item.title).toBe('Dropped Movie');
    const status = (
      await app.inject({ method: 'GET', url: `/api/libraries/${libraryId}/scan`, headers })
    ).json() as Record<string, unknown>;
    expect(status).toMatchObject({ state: 'idle', filesSeen: 1, filesProbed: 1, itemsLinked: 1 });

    rmSync(target);
    await waitFor(async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/libraries/${libraryId}/scan`,
        headers,
      });
      const s = res.json() as { filesMissing: number; state: string };
      return s.state === 'idle' && s.filesMissing === 1 ? s : null;
    });
    const detail = (
      await app.inject({ method: 'GET', url: `/api/items/${item.id}`, headers })
    ).json() as { files: unknown[] };
    expect(detail.files).toEqual([]);
  }, 60_000);

  it('coalesces a scan requested while one is running into a single rerun', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/libraries',
      headers,
      payload: { name: 'Second', kind: 'movie', paths: [`${fixtures}/movies`] },
    });
    const libraryId = (create.json() as { id: string }).id;
    const first = (
      await app.inject({ method: 'POST', url: `/api/libraries/${libraryId}/scan`, headers })
    ).statusCode;
    const second = (
      await app.inject({ method: 'POST', url: `/api/libraries/${libraryId}/scan`, headers })
    ).statusCode;
    expect([first, second]).toEqual([202, 202]);
    await app.scans.whenIdle();
    const status = (
      await app.inject({ method: 'GET', url: `/api/libraries/${libraryId}/scan`, headers })
    ).json() as Record<string, unknown>;
    expect(status).toMatchObject({ state: 'idle', filesSeen: 2, error: null });
  }, 60_000);
});
