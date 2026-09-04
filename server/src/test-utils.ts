import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configForDataDir, type Config } from './config.js';

/** A Config rooted in a fresh temp directory, plus a cleanup that deletes it. */
export function makeTestConfig(): { config: Config; cleanup: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'projektor-test-'));
  return {
    config: configForDataDir(dir, { logLevel: 'fatal' }),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** Runs first-time setup on a freshly built app and returns the admin's bearer token and id. */
export async function setupAdmin(
  app: {
    inject: (opts: {
      method: 'POST';
      url: string;
      payload: unknown;
    }) => Promise<{ json: () => unknown }>;
  },
  name = 'Admin',
  pin = '1234',
): Promise<{ token: string; id: string }> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { name, pin } });
  const body = res.json() as { token: string; profile: { id: string } };
  return { token: body.token, id: body.profile.id };
}

/** Absolute path of the generated fixtures directory (see scripts/make-fixtures.sh). */
export function fixturesDir(): string {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../fixtures');
}
