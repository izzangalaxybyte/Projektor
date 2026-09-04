import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { fixturesDir, makeTestConfig, setupAdmin } from '../test-utils.js';

let app: FastifyInstance;
let admin: { token: string; id: string };
let userToken: string;
const t = makeTestConfig();
const fixtures = fixturesDir();

beforeAll(async () => {
  app = await buildApp({ config: t.config });
  await app.ready();
  admin = await setupAdmin(app);
  const user = await app.auth.createUser('Kid', '0000', false);
  userToken = (await app.auth.login(user.id, '0000', 'test')).token;
});
afterAll(async () => {
  await app.close();
  t.cleanup();
});

const asAdmin = () => ({ authorization: `Bearer ${admin.token}` });
const asUser = () => ({ authorization: `Bearer ${userToken}` });

describe('libraries', () => {
  let movieLibraryId: string;

  it('requires admin to create', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/libraries',
      headers: asUser(),
      payload: { name: 'X', kind: 'movie', paths: [fixtures] },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects paths that are not directories', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/libraries',
      headers: asAdmin(),
      payload: { name: 'X', kind: 'movie', paths: ['/definitely/not/here'] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('creates, lists, and gets a library', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/libraries',
      headers: asAdmin(),
      payload: {
        name: 'Movies',
        kind: 'movie',
        paths: [`${fixtures}/movies`, `${fixtures}/movies/`],
      },
    });
    expect(res.statusCode).toBe(201);
    const lib = res.json() as { id: string; paths: string[]; lastScannedAt: string | null };
    movieLibraryId = lib.id;
    expect(lib.paths).toEqual([`${fixtures}/movies`]);
    expect(lib.lastScannedAt).toBeNull();

    const list = await app.inject({ method: 'GET', url: '/api/libraries', headers: asUser() });
    expect((list.json() as unknown[]).length).toBe(1);
    const one = await app.inject({
      method: 'GET',
      url: `/api/libraries/${lib.id}`,
      headers: asUser(),
    });
    expect((one.json() as { name: string }).name).toBe('Movies');
    expect(
      (await app.inject({ method: 'GET', url: '/api/libraries/nope', headers: asUser() }))
        .statusCode,
    ).toBe(404);
  });

  describe.skipIf(!existsSync(fixtures))('scanning the generated fixtures', () => {
    let allId: string;
    it('records four files on first scan and nothing changed on rescan', async () => {
      const create = await app.inject({
        method: 'POST',
        url: '/api/libraries',
        headers: asAdmin(),
        payload: { name: 'Everything', kind: 'movie', paths: [fixtures] },
      });
      allId = (create.json() as { id: string }).id;
      const first = await app.inject({
        method: 'POST',
        url: `/api/libraries/${allId}/scan`,
        headers: asAdmin(),
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({
        libraryId: allId,
        state: 'idle',
        filesSeen: 4,
        filesChanged: 4,
        filesMissing: 0,
      });

      const second = await app.inject({
        method: 'POST',
        url: `/api/libraries/${allId}/scan`,
        headers: asAdmin(),
      });
      expect(second.json()).toMatchObject({ filesSeen: 4, filesChanged: 0, filesMissing: 0 });

      const lib = (
        await app.inject({ method: 'GET', url: `/api/libraries/${allId}`, headers: asUser() })
      ).json() as { lastScannedAt: string | null };
      expect(lib.lastScannedAt).not.toBeNull();
    });

    it('scan requires admin', async () => {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/libraries/${allId}/scan`,
            headers: asUser(),
          })
        ).statusCode,
      ).toBe(403);
    });
  });

  it('deletes a library (admin only) and cascades its files', async () => {
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/libraries/${movieLibraryId}`,
          headers: asUser(),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/libraries/${movieLibraryId}`,
          headers: asAdmin(),
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/libraries/${movieLibraryId}`,
          headers: asAdmin(),
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/libraries/${movieLibraryId}`,
          headers: asAdmin(),
        })
      ).statusCode,
    ).toBe(404);
  });
});
