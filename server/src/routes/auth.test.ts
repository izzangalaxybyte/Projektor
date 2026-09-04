import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { MAX_FAILED_ATTEMPTS } from '../auth/service.js';
import { makeTestConfig } from '../test-utils.js';

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

const json = (res: { json: () => unknown }) => res.json() as Record<string, unknown>;

describe('auth', () => {
  let adminId: string;
  let adminToken: string;

  it('rejects protected routes without a token and allows public ones', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/auth/me',
          headers: { authorization: 'Bearer nope' },
        })
      ).statusCode,
    ).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    expect(json(await app.inject({ method: 'GET', url: '/api/auth/setup' }))).toEqual({
      needsSetup: true,
    });
  });

  it('creates the first admin through setup and refuses a second setup', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { name: 'Izzan', pin: '1234' },
    });
    expect(res.statusCode).toBe(200);
    const body = json(res) as { token: string; profile: { id: string; isAdmin: boolean } };
    expect(body.profile.isAdmin).toBe(true);
    adminId = body.profile.id;
    adminToken = body.token;
    expect(json(await app.inject({ method: 'GET', url: '/api/auth/setup' }))).toEqual({
      needsSetup: false,
    });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/setup',
          payload: { name: 'X', pin: '0000' },
        })
      ).statusCode,
    ).toBe(409);
  });

  it('lists profiles without exposing hashes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/profiles' });
    const profiles = res.json() as Array<Record<string, unknown>>;
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.['name']).toBe('Izzan');
    expect(profiles[0]).not.toHaveProperty('pinHash');
  });

  it('rejects a malformed PIN at validation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { profileId: adminId, pin: 'abcd', deviceName: 'test' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('logs in with the right PIN and serves /me and /sessions', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { profileId: adminId, pin: '1234', deviceName: 'Living room TV' },
    });
    expect(res.statusCode).toBe(200);
    const { token } = json(res) as { token: string };
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(json(me)['id']).toBe(adminId);

    const sessions = await app.inject({
      method: 'GET',
      url: '/api/auth/sessions',
      headers: { authorization: `Bearer ${token}` },
    });
    const list = sessions.json() as Array<{ deviceName: string; current: boolean }>;
    expect(list.map((s) => s.deviceName).sort()).toEqual(['Living room TV', 'Setup']);
    expect(list.find((s) => s.current)?.deviceName).toBe('Living room TV');
  });

  it('revoking a session invalidates its token', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { profileId: adminId, pin: '1234', deviceName: 'Phone' },
    });
    const { token } = json(login) as { token: string };
    const sessions = (
      await app.inject({
        method: 'GET',
        url: '/api/auth/sessions',
        headers: { authorization: `Bearer ${adminToken}` },
      })
    ).json() as Array<{ id: string; deviceName: string }>;
    const phone = sessions.find((s) => s.deviceName === 'Phone')!;
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/auth/sessions/${phone.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(del.statusCode).toBe(204);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/auth/me',
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/auth/sessions/${phone.id}`,
          headers: { authorization: `Bearer ${adminToken}` },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('logout revokes the current token', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { profileId: adminId, pin: '1234', deviceName: 'Tablet' },
    });
    const { token } = json(login) as { token: string };
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/logout',
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/auth/me',
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('locks the profile after repeated wrong PINs, even for the right PIN', async () => {
    const user = await app.auth.createUser('Guest', '4321', false);
    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { profileId: user.id, pin: '9999', deviceName: 'x' },
      });
      expect(res.statusCode, `attempt ${i}`).toBe(401);
    }
    const fifth = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { profileId: user.id, pin: '9999', deviceName: 'x' },
    });
    expect(fifth.statusCode).toBe(423);
    const sixth = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { profileId: user.id, pin: '4321', deviceName: 'x' },
    });
    expect(sixth.statusCode).toBe(423);
  });

  it('returns 401 for an unknown profile without leaking existence', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { profileId: 'does-not-exist', pin: '1234', deviceName: 'x' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rate limits login attempts per IP', async () => {
    let limited = false;
    for (let i = 0; i < 25 && !limited; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: '10.0.0.9',
        payload: { profileId: 'nobody', pin: '0000', deviceName: 'x' },
      });
      if (res.statusCode === 429) limited = true;
    }
    expect(limited).toBe(true);
  });
});
