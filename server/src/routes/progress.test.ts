import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { fixturesDir, makeTestConfig, scanAndWait, setupAdmin } from '../test-utils.js';

const fixtures = fixturesDir();
const t = makeTestConfig();
let app: FastifyInstance;
let headers: Record<string, string>;
let kidHeaders: Record<string, string>;
let movieId: string;
let episodeId: string;
let showId: string;

type Summary = {
  id: string;
  kind: string;
  title: string;
  libraryKind: string;
  progress: { positionMs: number; watched: boolean } | null;
  favorite: boolean;
};

beforeAll(async () => {
  app = await buildApp({ config: t.config });
  await app.ready();
  headers = { authorization: `Bearer ${(await setupAdmin(app)).token}` };
  const kid = await app.auth.createUser('Kid', false);
  kidHeaders = { authorization: `Bearer ${(await app.auth.login(kid.id, 't')).token}` };
  if (!existsSync(fixtures)) return;
  for (const [name, kind, dir] of [
    ['Movies', 'movie', 'movies'],
    ['TV', 'tv', 'tv'],
  ] as const) {
    const create = await app.inject({
      method: 'POST',
      url: '/api/libraries',
      headers,
      payload: { name, kind, paths: [`${fixtures}/${dir}`] },
    });
    await scanAndWait(app, headers, (create.json() as { id: string }).id);
  }
  const movies = (
    await app.inject({ method: 'GET', url: '/api/items?libraryKind=movie&search=Sample', headers })
  ).json() as { items: Summary[] };
  movieId = movies.items[0]!.id;
  const shows = (
    await app.inject({ method: 'GET', url: '/api/items?libraryKind=tv', headers })
  ).json() as { items: Summary[] };
  showId = shows.items[0]!.id;
  const show = (
    await app.inject({ method: 'GET', url: `/api/items/${showId}`, headers })
  ).json() as { children: Summary[] };
  const eps = (
    await app.inject({ method: 'GET', url: `/api/items?parentId=${show.children[0]!.id}`, headers })
  ).json() as { items: Summary[] };
  episodeId = eps.items[0]!.id;
});
afterAll(async () => {
  await app.close();
  t.cleanup();
});

describe.skipIf(!existsSync(fixtures))('progress routes', () => {
  it('records progress and shows it on summaries and details for that user only', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/progress',
      headers,
      payload: { itemId: movieId, positionMs: 12_000, durationMs: 30_000 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ positionMs: 12_000, watched: false });

    const detail = (
      await app.inject({ method: 'GET', url: `/api/items/${movieId}`, headers })
    ).json() as Summary;
    expect(detail.progress).toMatchObject({ positionMs: 12_000, watched: false });
    const list = (
      await app.inject({ method: 'GET', url: '/api/items?libraryKind=movie', headers })
    ).json() as { items: Summary[] };
    expect(list.items.find((i) => i.id === movieId)?.progress?.positionMs).toBe(12_000);
    const kidView = (
      await app.inject({ method: 'GET', url: `/api/items/${movieId}`, headers: kidHeaders })
    ).json() as Summary;
    expect(kidView.progress).toBeNull();
  });

  it('lists continue watching per library kind and drops watched items', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/progress',
      headers,
      payload: { itemId: episodeId, positionMs: 5_000, durationMs: 30_000 },
    });
    const all = (
      await app.inject({ method: 'GET', url: '/api/progress/continue', headers })
    ).json() as Summary[];
    expect(all.map((i) => i.id)).toEqual([episodeId, movieId]);
    const tv = (
      await app.inject({ method: 'GET', url: '/api/progress/continue?libraryKind=tv', headers })
    ).json() as Summary[];
    expect(tv.map((i) => i.kind)).toEqual(['episode']);

    await app.inject({
      method: 'POST',
      url: '/api/progress',
      headers,
      payload: { itemId: movieId, positionMs: 29_000, durationMs: 30_000 },
    });
    const after = (
      await app.inject({ method: 'GET', url: '/api/progress/continue', headers })
    ).json() as Summary[];
    expect(after.map((i) => i.id)).toEqual([episodeId]);
    expect(
      (
        (
          await app.inject({ method: 'GET', url: `/api/items/${movieId}`, headers })
        ).json() as Summary
      ).progress?.watched,
    ).toBe(true);
    expect(
      (
        await app.inject({ method: 'GET', url: '/api/progress/continue', headers: kidHeaders })
      ).json(),
    ).toEqual([]);
  });

  it('marks watched and unwatched explicitly', async () => {
    const mark = await app.inject({
      method: 'PUT',
      url: `/api/progress/${episodeId}/watched`,
      headers,
      payload: { watched: true },
    });
    expect(mark.statusCode).toBe(200);
    expect(mark.json()).toMatchObject({ watched: true });
    expect(
      (await app.inject({ method: 'GET', url: '/api/progress/continue', headers })).json(),
    ).toEqual([]);
    const clear = await app.inject({
      method: 'PUT',
      url: `/api/progress/${episodeId}/watched`,
      headers,
      payload: { watched: false },
    });
    expect(clear.json()).toBeNull();
    expect(
      (
        (
          await app.inject({ method: 'GET', url: `/api/items/${episodeId}`, headers })
        ).json() as Summary
      ).progress,
    ).toBeNull();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/progress',
          headers,
          payload: { itemId: 'nope', positionMs: 1, durationMs: 2 },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('answers next episode (null at the end of the fixture show) and 404 for non-episodes', async () => {
    expect(
      (await app.inject({ method: 'GET', url: `/api/items/${episodeId}/next`, headers })).json(),
    ).toBeNull();
    expect(
      (await app.inject({ method: 'GET', url: `/api/items/${movieId}/next`, headers })).statusCode,
    ).toBe(404);
  });

  it('favorites movies and shows per user, newest first, and rejects episodes', async () => {
    const put = (itemId: string, favorite: boolean, h = headers) =>
      app.inject({
        method: 'PUT',
        url: `/api/favorites/${itemId}`,
        headers: h,
        payload: { favorite },
      });
    expect((await put(movieId, true)).json()).toEqual({ favorite: true });
    await new Promise((r) => setTimeout(r, 5));
    expect((await put(showId, true)).json()).toEqual({ favorite: true });
    expect((await put(showId, true)).statusCode).toBe(200);
    expect((await put(episodeId, true)).statusCode).toBe(404);

    const list = (
      await app.inject({ method: 'GET', url: '/api/favorites', headers })
    ).json() as Summary[];
    expect(list.map((i) => i.id)).toEqual([showId, movieId]);
    expect(list.every((i) => i.favorite)).toBe(true);
    const tv = (
      await app.inject({ method: 'GET', url: '/api/favorites?libraryKind=tv', headers })
    ).json() as Summary[];
    expect(tv.map((i) => i.id)).toEqual([showId]);
    expect(
      (
        (
          await app.inject({ method: 'GET', url: `/api/items/${showId}`, headers })
        ).json() as Summary
      ).favorite,
    ).toBe(true);
    expect(
      (await app.inject({ method: 'GET', url: '/api/favorites', headers: kidHeaders })).json(),
    ).toEqual([]);

    expect((await put(showId, false)).json()).toEqual({ favorite: false });
    const after = (
      await app.inject({ method: 'GET', url: '/api/items?libraryKind=tv', headers })
    ).json() as { items: Summary[] };
    expect(after.items.find((i) => i.id === showId)?.favorite).toBe(false);
  });
});
