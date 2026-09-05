import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { fixturesDir, makeTestConfig, scanAndWait, setupAdmin } from '../test-utils.js';

const fixtures = fixturesDir();
let app: FastifyInstance;
let headers: Record<string, string>;
const t = makeTestConfig();

beforeAll(async () => {
  app = await buildApp({ config: t.config });
  await app.ready();
  const admin = await setupAdmin(app);
  headers = { authorization: `Bearer ${admin.token}` };
});
afterAll(async () => {
  await app.close();
  t.cleanup();
});

async function createAndScan(name: string, kind: string, dir: string) {
  const create = await app.inject({
    method: 'POST',
    url: '/api/libraries',
    headers,
    payload: { name, kind, paths: [dir] },
  });
  const id = (create.json() as { id: string }).id;
  const scan = (await scanAndWait(app, headers, id)) as Record<string, number>;
  return { id, scan };
}

type Summary = {
  id: string;
  kind: string;
  title: string;
  year: number | null;
  libraryKind: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
  needsReview: boolean;
};
type Page = { items: Summary[]; total: number };

describe.skipIf(!existsSync(fixtures))('items over the generated fixtures', () => {
  it('scan links every probed file to an item', async () => {
    const movies = await createAndScan('Movies', 'movie', `${fixtures}/movies`);
    expect(movies.scan).toMatchObject({ filesSeen: 2, filesProbed: 2, itemsLinked: 2 });
    const tv = await createAndScan('TV', 'tv', `${fixtures}/tv`);
    expect(tv.scan).toMatchObject({ filesSeen: 1, itemsLinked: 1 });
    const anime = await createAndScan('Anime', 'anime', `${fixtures}/anime`);
    expect(anime.scan).toMatchObject({ filesSeen: 1, itemsLinked: 1 });
  });

  it('lists top-level items per library kind', async () => {
    const all = (await app.inject({ method: 'GET', url: '/api/items', headers })).json() as Page;
    expect(all.total).toBe(4);
    expect(
      all.items.filter((i) => i.libraryKind !== 'anime').map((i) => [i.kind, i.title]),
    ).toEqual([
      ['movie', 'Sample Movie'],
      ['show', 'Sample Show'],
      ['movie', 'some random download'],
    ]);
    expect(
      all.items.filter((i) => i.libraryKind === 'anime').map((i) => [i.kind, i.title]),
    ).toEqual([['show', 'Sample Anime']]);

    const tv = (
      await app.inject({ method: 'GET', url: '/api/items?libraryKind=tv', headers })
    ).json() as Page;
    expect(tv.items.map((i) => i.title)).toEqual(['Sample Show']);
    const anime = (
      await app.inject({ method: 'GET', url: '/api/items?libraryKind=anime', headers })
    ).json() as Page;
    expect(anime.total).toBe(1);
    expect(anime.items[0]?.libraryKind).toBe('anime');
    const moviesOnly = (
      await app.inject({ method: 'GET', url: '/api/items?libraryKind=movie&sort=year', headers })
    ).json() as Page;
    expect(moviesOnly.items.map((i) => i.year)).toEqual([2021, 2019]);
  });

  it('searches, filters needsReview, and paginates', async () => {
    const search = (
      await app.inject({ method: 'GET', url: '/api/items?search=Sample%20Movie', headers })
    ).json() as Page;
    expect(search.items.map((i) => i.title)).toEqual(['Sample Movie']);
    const review = (
      await app.inject({ method: 'GET', url: '/api/items?needsReview=true', headers })
    ).json() as Page;
    expect(review.total).toBe(4);
    const clean = (
      await app.inject({ method: 'GET', url: '/api/items?needsReview=false', headers })
    ).json() as Page;
    expect(clean.total).toBe(0);
    const page = (
      await app.inject({ method: 'GET', url: '/api/items?limit=2&offset=2', headers })
    ).json() as Page & { offset: number; limit: number };
    expect(page.items).toHaveLength(2);
    expect(page).toMatchObject({ total: 4, offset: 2, limit: 2 });
  });

  it('walks show -> season -> episode and exposes files with streams', async () => {
    const tv = (
      await app.inject({ method: 'GET', url: '/api/items?libraryKind=tv', headers })
    ).json() as Page;
    const show = (
      await app.inject({ method: 'GET', url: `/api/items/${tv.items[0]!.id}`, headers })
    ).json() as { children: Summary[]; files: unknown[] };
    expect(show.files).toEqual([]);
    expect(show.children.map((c) => [c.kind, c.seasonNumber])).toEqual([['season', 1]]);

    const seasonChildren = (
      await app.inject({
        method: 'GET',
        url: `/api/items?parentId=${show.children[0]!.id}`,
        headers,
      })
    ).json() as Page;
    expect(seasonChildren.items.map((c) => [c.kind, c.seasonNumber, c.episodeNumber])).toEqual([
      ['episode', 1, 2],
    ]);

    const episode = (
      await app.inject({ method: 'GET', url: `/api/items/${seasonChildren.items[0]!.id}`, headers })
    ).json() as {
      title: string;
      showTitle: string;
      files: Array<{
        container: string;
        durationMs: number;
        streams: Array<{ type: string; codec: string }>;
      }>;
    };
    expect(episode.showTitle).toBe('Sample Show');
    expect(episode.title).toBe('Episode 2');
    expect(episode.files).toHaveLength(1);
    expect(episode.files[0]).toMatchObject({ container: 'mkv' });
    expect(episode.files[0]!.durationMs).toBeGreaterThan(29_000);
    expect(episode.files[0]!.streams.map((s) => s.codec)).toEqual(['hevc', 'ac3', 'subrip']);
  });

  it('lists anime episodes under the show by absolute number until seasons are mapped', async () => {
    const anime = (
      await app.inject({ method: 'GET', url: '/api/items?libraryKind=anime', headers })
    ).json() as Page;
    const show = (
      await app.inject({ method: 'GET', url: `/api/items/${anime.items[0]!.id}`, headers })
    ).json() as { children: Summary[] };
    expect(
      show.children.map((c) => [c.kind, c.seasonNumber, c.episodeNumber, c.title, c.needsReview]),
    ).toEqual([['episode', null, 13, 'Episode 13', false]]);
    const episode = (
      await app.inject({ method: 'GET', url: `/api/items/${show.children[0]!.id}`, headers })
    ).json() as {
      files: Array<{ streams: Array<{ type: string; language: string | null }> }>;
    };
    expect(
      episode.files[0]!.streams.filter((s) => s.type === 'audio').map((s) => s.language),
    ).toEqual(['jpn', 'eng']);
  });

  it('404s for unknown ids', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/items/nope', headers })).statusCode).toBe(
      404,
    );
  });
});
