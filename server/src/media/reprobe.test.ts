import { existsSync } from 'node:fs';
import { eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { schema } from '../db/index.js';
import { fixturesDir, makeTestConfig, scanAndWait, setupAdmin } from '../test-utils.js';

const fixtures = fixturesDir();
const t = makeTestConfig();
let app: FastifyInstance;
let headers: Record<string, string>;
let libraryId: string;

beforeAll(async () => {
  app = await buildApp({ config: t.config });
  await app.ready();
  headers = { authorization: `Bearer ${(await setupAdmin(app)).token}` };
  if (!existsSync(fixtures)) return;
  const create = await app.inject({
    method: 'POST',
    url: '/api/libraries',
    headers,
    payload: { name: 'Movies', kind: 'movie', paths: [`${fixtures}/movies`] },
  });
  libraryId = (create.json() as { id: string }).id;
  await scanAndWait(app, headers, libraryId);
});
afterAll(async () => {
  await app.close();
  t.cleanup();
});

describe.skipIf(!existsSync(fixtures))('re-probing for bit depth', () => {
  it('records bit depth and HDR on a fresh probe and keeps the full ffprobe output', async () => {
    const videos = app.db
      .select()
      .from(schema.streams)
      .where(eq(schema.streams.type, 'video'))
      .all();
    expect(videos.length).toBeGreaterThan(0);
    for (const v of videos) expect(v).toMatchObject({ bitDepth: 8, hdr: false });
    const file = app.db
      .select({ probeJson: schema.mediaFiles.probeJson })
      .from(schema.mediaFiles)
      .limit(1)
      .get()!;
    expect(file.probeJson).toContain('"pix_fmt"');
  });

  it('re-probes files whose video stream lacks bit depth on the next scan, and only those', async () => {
    const [first, ...rest] = app.db
      .select()
      .from(schema.streams)
      .where(eq(schema.streams.type, 'video'))
      .all();
    app.db
      .update(schema.streams)
      .set({ bitDepth: null })
      .where(eq(schema.streams.id, first!.id))
      .run();
    const status = await scanAndWait(app, headers, libraryId);
    expect(status.filesChanged).toBe(1);
    expect(status.filesProbed).toBe(1);
    expect(
      app.db
        .select()
        .from(schema.streams)
        .where(isNull(schema.streams.bitDepth))
        .all()
        .filter((s) => s.type === 'video'),
    ).toHaveLength(0);
    // Untouched rows kept their ids: nothing else was re-probed.
    for (const r of rest)
      expect(
        app.db.select().from(schema.streams).where(eq(schema.streams.id, r.id)).get(),
      ).toBeTruthy();
  });

  it('asks for that scan by itself on startup', async () => {
    const [first] = app.db
      .select()
      .from(schema.streams)
      .where(eq(schema.streams.type, 'video'))
      .all();
    app.db
      .update(schema.streams)
      .set({ bitDepth: null })
      .where(eq(schema.streams.id, first!.id))
      .run();
    await app.close();
    app = await buildApp({ config: t.config });
    await app.ready();
    await app.scans.whenIdle();
    expect(
      app.db
        .select()
        .from(schema.streams)
        .where(isNull(schema.streams.bitDepth))
        .all()
        .filter((s) => s.type === 'video'),
    ).toHaveLength(0);
  });
});
