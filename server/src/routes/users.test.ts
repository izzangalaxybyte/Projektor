import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { makeTestConfig, setupAdmin } from '../test-utils.js';

const t = makeTestConfig();
let app: FastifyInstance;
let admin: { token: string; id: string };
beforeAll(async () => {
  app = await buildApp({ config: t.config });
  await app.ready();
  admin = await setupAdmin(app);
});
afterAll(async () => {
  await app.close();
  t.cleanup();
});
const headers = () => ({ authorization: `Bearer ${admin.token}` });

describe('users', () => {
  it('lets an admin create, list, and delete profiles, but not itself, and not as a non-admin', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: headers(),
      payload: { name: 'Kid', pin: '0000' },
    });
    expect(create.statusCode).toBe(201);
    const kid = create.json() as { id: string; isAdmin: boolean };
    expect(kid.isAdmin).toBe(false);
    const list = (
      await app.inject({ method: 'GET', url: '/api/users', headers: headers() })
    ).json() as Array<{ name: string }>;
    expect(list.map((u) => u.name).sort()).toEqual(['Admin', 'Kid']);

    const kidToken = (await app.auth.login(kid.id, '0000', 't')).token;
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/users',
          headers: { authorization: `Bearer ${kidToken}` },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/users/${admin.id}`, headers: headers() }))
        .statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/users/${kid.id}`, headers: headers() }))
        .statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/auth/me',
          headers: { authorization: `Bearer ${kidToken}` },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/users/${kid.id}`, headers: headers() }))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/users',
          headers: headers(),
          payload: { name: 'X', pin: '12' },
        })
      ).statusCode,
    ).toBe(400);
  });
});
