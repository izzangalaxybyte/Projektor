import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configForDataDir, type Config } from './config.js';

/** A Config rooted in a fresh temp directory, plus a cleanup that deletes it. */
export function makeTestConfig(): { config: Config; cleanup: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'projektor-test-'));
  return {
    config: configForDataDir(dir, {
      logLevel: 'fatal',
      watchLibraries: false,
      scanDebounceMs: 200,
    }),
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

type Injectable = {
  inject: (opts: {
    method: 'GET' | 'POST';
    url: string;
    headers?: Record<string, string>;
  }) => Promise<{ json: () => unknown; statusCode: number }>;
};

/** Queues a scan and polls its status until the run finishes. Returns the final ScanStatus. */
export async function scanAndWait(
  app: Injectable,
  headers: Record<string, string>,
  libraryId: string,
  timeoutMs = 30_000,
): Promise<Record<string, unknown>> {
  const queued = await app.inject({
    method: 'POST',
    url: `/api/libraries/${libraryId}/scan`,
    headers,
  });
  if (queued.statusCode !== 202) throw new Error(`scan request failed with ${queued.statusCode}`);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await app.inject({
      method: 'GET',
      url: `/api/libraries/${libraryId}/scan`,
      headers,
    });
    const status = res.json() as Record<string, unknown>;
    if (status['state'] === 'idle' && status['finishedAt']) return status;
    if (Date.now() > deadline) throw new Error('scan did not finish in time');
    await new Promise((r) => setTimeout(r, 50));
  }
}
