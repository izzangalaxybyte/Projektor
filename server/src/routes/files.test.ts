import { existsSync, statSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { fixturesDir, makeTestConfig, scanAndWait, setupAdmin } from '../test-utils.js';
import { parseRange } from './files.js';

describe('parseRange', () => {
  it('handles absent, closed, open-ended, suffix, and invalid ranges', () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=0-500', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=100-', 100)).toBe('invalid');
    expect(parseRange('bytes=5-2', 100)).toBe('invalid');
    expect(parseRange('bytes=-', 100)).toBe('invalid');
    expect(parseRange('items=0-1', 100)).toBe('invalid');
  });
});

const fixtures = fixturesDir();
const t = makeTestConfig();
let app: FastifyInstance;
let token: string;
let headers: Record<string, string>;
let fileId: string;
let filePath: string;

beforeAll(async () => {
  app = await buildApp({ config: t.config });
  await app.ready();
  token = (await setupAdmin(app)).token;
  headers = { authorization: `Bearer ${token}` };
  if (existsSync(fixtures)) {
    const create = await app.inject({
      method: 'POST',
      url: '/api/libraries',
      headers,
      payload: { name: 'TV', kind: 'tv', paths: [`${fixtures}/tv`] },
    });
    const libraryId = (create.json() as { id: string }).id;
    await scanAndWait(app, headers, libraryId);
    const shows = (
      await app.inject({ method: 'GET', url: '/api/items?libraryKind=tv', headers })
    ).json() as { items: Array<{ id: string }> };
    const show = (
      await app.inject({ method: 'GET', url: `/api/items/${shows.items[0]!.id}`, headers })
    ).json() as { children: Array<{ id: string }> };
    const episodes = (
      await app.inject({
        method: 'GET',
        url: `/api/items?parentId=${show.children[0]!.id}`,
        headers,
      })
    ).json() as { items: Array<{ id: string }> };
    const episode = (
      await app.inject({ method: 'GET', url: `/api/items/${episodes.items[0]!.id}`, headers })
    ).json() as { files: Array<{ id: string }> };
    fileId = episode.files[0]!.id;
    filePath = `${fixtures}/tv/Sample.Show.S01E02.1080p.WEB.H265-GRP.mkv`;
  }
});
afterAll(async () => {
  await app.close();
  t.cleanup();
});

describe.skipIf(!existsSync(fixtures))('GET /api/files/:id/stream', () => {
  it('serves the whole file with size and type', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/files/${fileId}/stream`, headers });
    const size = statSync(filePath).size;
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('video/x-matroska');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(Number(res.headers['content-length'])).toBe(size);
    expect(res.rawPayload.length).toBe(size);
  });

  it('serves byte ranges with 206', async () => {
    const size = statSync(filePath).size;
    const first = await app.inject({
      method: 'GET',
      url: `/api/files/${fileId}/stream`,
      headers: { ...headers, range: 'bytes=0-99' },
    });
    expect(first.statusCode).toBe(206);
    expect(first.headers['content-range']).toBe(`bytes 0-99/${size}`);
    expect(first.rawPayload.length).toBe(100);
    // Matroska files start with the EBML magic.
    expect(first.rawPayload.subarray(0, 4).toString('hex')).toBe('1a45dfa3');

    const tail = await app.inject({
      method: 'GET',
      url: `/api/files/${fileId}/stream`,
      headers: { ...headers, range: `bytes=${size - 10}-` },
    });
    expect(tail.statusCode).toBe(206);
    expect(tail.rawPayload.length).toBe(10);
  });

  it('rejects unsatisfiable ranges with 416', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/files/${fileId}/stream`,
      headers: { ...headers, range: 'bytes=999999999-' },
    });
    expect(res.statusCode).toBe(416);
    expect(res.headers['content-range']).toMatch(/^bytes \*\/\d+$/);
  });

  it('answers HEAD with headers only', async () => {
    const res = await app.inject({ method: 'HEAD', url: `/api/files/${fileId}/stream`, headers });
    expect(res.statusCode).toBe(200);
    expect(Number(res.headers['content-length'])).toBe(statSync(filePath).size);
    expect(res.rawPayload.length).toBe(0);
  });

  it('accepts the token as a query parameter, but only on reads', async () => {
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/files/${fileId}/stream?access_token=${token}`,
          headers: { range: 'bytes=0-1' },
        })
      ).statusCode,
    ).toBe(206);
    expect(
      (await app.inject({ method: 'GET', url: `/api/files/${fileId}/stream` })).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url: `/api/auth/logout?access_token=${token}` }))
        .statusCode,
    ).toBe(401);
  });

  it('404s for unknown ids', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/api/files/nope/stream', headers })).statusCode,
    ).toBe(404);
  });
});
