import { expect, type APIRequestContext, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
export const ADMIN = { name: 'Izzan', pin: '1234' };

/** Enters a PIN through the on-screen pad and presses OK. */
export async function enterPin(page: Page, pin: string) {
  for (const digit of pin) await page.getByRole('button', { name: digit, exact: true }).click();
  await page.getByRole('button', { name: 'OK' }).click();
}

/** First-run setup through the API if needed; returns a bearer token for API seeding. */
export async function ensureAdmin(request: APIRequestContext): Promise<string> {
  const status = await (await request.get('/api/auth/setup')).json();
  if (status.needsSetup) {
    const res = await request.post('/api/auth/setup', { data: ADMIN });
    return (await res.json()).token;
  }
  const profiles = await (await request.get('/api/auth/profiles')).json();
  const res = await request.post('/api/auth/login', {
    data: { profileId: profiles[0].id, pin: ADMIN.pin, deviceName: 'e2e' },
  });
  return (await res.json()).token;
}

/** Creates a library over a fixtures folder and waits for its scan to finish. */
export async function seedLibrary(
  request: APIRequestContext,
  token: string,
  name: string,
  kind: string,
  dir: string,
) {
  const headers = { authorization: `Bearer ${token}` };
  const existing = (await (await request.get('/api/libraries', { headers })).json()) as Array<{
    id: string;
    name: string;
  }>;
  const found = existing.find((l) => l.name === name);
  const id = found
    ? found.id
    : (
        await (
          await request.post('/api/libraries', { headers, data: { name, kind, paths: [dir] } })
        ).json()
      ).id;
  await request.post(`/api/libraries/${id}/scan`, { headers });
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/libraries/${id}/scan`, { headers })).json()).finishedAt,
      { timeout: 90_000 },
    )
    .not.toBeNull();
  return id as string;
}

/** Signs in through the UI as the admin. */
export async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByTestId(`profile-${ADMIN.name}`).click();
  await enterPin(page, ADMIN.pin);
  await expect(page).toHaveURL(/\/$/);
}
