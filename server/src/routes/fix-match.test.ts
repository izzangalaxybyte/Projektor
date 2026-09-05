import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { fakeAniListFetch } from '../metadata/fake-anilist.js';
import { fakeTmdbFetch } from '../metadata/fake-tmdb.js';
import { fixturesDir, makeTestConfig, scanAndWait, setupAdmin } from '../test-utils.js';

const fixtures = fixturesDir();
const t = makeTestConfig();
let app: FastifyInstance;
let headers: Record<string, string>;

const tmdbFetch = fakeTmdbFetch({
  movies: [
    { id: 101, title: 'Heat', year: 1995 },
    { id: 103, title: 'Sample Movie', year: 2019 },
  ],
  shows: [
    {
      id: 201,
      name: 'Sample Show',
      year: 2018,
      seasons: [
        {
          number: 1,
          episodes: [
            { number: 1, name: 'Pilot' },
            { number: 2, name: 'The Second One' },
          ],
        },
      ],
    },
    {
      id: 301,
      name: 'Sample Anime',
      year: 2020,
      seasons: [
        {
          number: 1,
          episodes: Array.from({ length: 12 }, (_, i) => ({
            number: i + 1,
            name: `S1 Ep ${i + 1}`,
          })),
        },
        {
          number: 2,
          episodes: Array.from({ length: 25 }, (_, i) => ({
            number: i + 1,
            name: `S2 Ep ${i + 1}`,
          })),
        },
      ],
    },
  ],
});
const anilistFetch = fakeAniListFetch([
  { id: 5001, english: 'Sample Anime', romaji: 'Sanpuru Anime', year: 2020, episodes: 37 },
]);
const routedFetch = (url: string, init?: RequestInit) =>
  url.includes('anilist') ? anilistFetch(url, init) : tmdbFetch(url, init);

beforeAll(async () => {
  app = await buildApp({ config: t.config, fetch: routedFetch });
  await app.ready();
  headers = { authorization: `Bearer ${(await setupAdmin(app)).token}` };
  await app.inject({
    method: 'PATCH',
    url: '/api/settings',
    headers,
    payload: { tmdbApiKey: 'key' },
  });
});
afterAll(async () => {
  await app.close();
  t.cleanup();
});

type Summary = {
  id: string;
  title: string;
  needsReview: boolean;
  seasonNumber: number | null;
  episodeNumber: number | null;
};
const list = async (q: string) =>
  (
    (await app.inject({ method: 'GET', url: `/api/items?${q}`, headers })).json() as {
      items: Summary[];
    }
  ).items;
const detail = async (id: string) =>
  (await app.inject({ method: 'GET', url: `/api/items/${id}`, headers })).json() as Summary & {
    tmdbId: number | null;
    anilistId: number | null;
    children: Summary[];
    genres: string[];
  };

describe.skipIf(!existsSync(fixtures))('scan matching and fix-match over the fixtures', () => {
  let unmatchedId: string;
  let animeId: string;

  it('scan matches what it can and leaves the rest for review', async () => {
    for (const [name, kind, dir] of [
      ['Movies', 'movie', 'movies'],
      ['TV', 'tv', 'tv'],
      ['Anime', 'anime', 'anime'],
    ] as const) {
      const create = await app.inject({
        method: 'POST',
        url: '/api/libraries',
        headers,
        payload: { name, kind, paths: [`${fixtures}/${dir}`] },
      });
      const id = (create.json() as { id: string }).id;
      const scan = (await scanAndWait(app, headers, id)) as Record<string, number>;
      expect(scan.itemsLinked).toBeGreaterThan(0);
    }
    const movies = await list('libraryKind=movie');
    expect(movies.map((m) => [m.title, m.needsReview])).toEqual([
      ['Sample Movie', false],
      ['some random download', true],
    ]);
    unmatchedId = movies[1]!.id;
    const shows = await list('libraryKind=tv');
    expect(shows[0]).toMatchObject({ title: 'Sample Show', needsReview: false });
    const anime = await list('libraryKind=anime');
    expect(anime[0]).toMatchObject({ title: 'Sample Anime', needsReview: false });
    animeId = anime[0]!.id;
    const animeDetail = await detail(animeId);
    expect(animeDetail).toMatchObject({ anilistId: 5001, tmdbId: 301 });
    // Absolute 13 mapped onto season 2 episode 1; the show now lists a season.
    expect(animeDetail.children.map((c) => [c.seasonNumber, c.episodeNumber])).toEqual([[2, null]]);
    const review = await list('needsReview=true');
    expect(review.map((r) => r.title)).toEqual(['some random download']);
  });

  it('lists candidates for an unmatched movie and applies the chosen one', async () => {
    const candidates = (
      await app.inject({
        method: 'GET',
        url: `/api/items/${unmatchedId}/candidates?query=Heat&year=1995`,
        headers,
      })
    ).json() as Array<{ source: string; id: number; title: string; score: number }>;
    expect(candidates[0]).toMatchObject({ source: 'tmdb', id: 101, title: 'Heat' });
    expect(candidates[0]!.score).toBeGreaterThan(0.85);

    const res = await app.inject({
      method: 'POST',
      url: `/api/items/${unmatchedId}/match`,
      headers,
      payload: { tmdbId: 101 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ title: 'Heat', tmdbId: 101, needsReview: false });
    expect(await list('needsReview=true')).toEqual([]);
  });

  it('remaps anime episodes when the season offset changes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/items/${animeId}/match`,
      headers,
      payload: { seasonOffset: 12 },
    });
    expect(res.statusCode).toBe(200);
    const season = (res.json() as { children: Summary[] }).children[0]!;
    const episodes = await list(`parentId=${season.id}`);
    // 13 + 12 = 25 → season 2 episode 13
    expect(episodes.map((e) => [e.seasonNumber, e.episodeNumber, e.title])).toEqual([
      [2, 13, 'S2 Ep 13'],
    ]);
  });

  it('offers AniList and TMDB candidates for anime and accepts anilistId', async () => {
    const candidates = (
      await app.inject({ method: 'GET', url: `/api/items/${animeId}/candidates`, headers })
    ).json() as Array<{ source: string; id: number }>;
    expect(candidates[0]).toMatchObject({ source: 'anilist', id: 5001 });
    // The fake TMDB matches on the first word, so 'Sample Show' comes back too, ranked below 'Sample Anime'.
    expect(candidates.filter((c) => c.source === 'tmdb').map((c) => c.id)).toEqual([301, 201]);
    const res = await app.inject({
      method: 'POST',
      url: `/api/items/${animeId}/match`,
      headers,
      payload: { anilistId: 5001 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ anilistId: 5001, tmdbId: 301 });
  });

  it('validates input', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/items/${unmatchedId}/match`,
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/items/${unmatchedId}/match`,
          headers,
          payload: { anilistId: 1 },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/items/nope/match`,
          headers,
          payload: { tmdbId: 1 },
        })
      ).statusCode,
    ).toBe(404);
    const kid = await app.auth.createUser('Kid', '0000', false);
    const kidToken = (await app.auth.login(kid.id, '0000', 't')).token;
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/items/${unmatchedId}/match`,
          headers: { authorization: `Bearer ${kidToken}` },
          payload: { tmdbId: 101 },
        })
      ).statusCode,
    ).toBe(403);
  });
});
