import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { now, openDatabase, schema, type Db } from '../db/index.js';
import { ItemsService } from '../items/service.js';
import { makeTestConfig } from '../test-utils.js';
import { AniListClient } from './anilist.js';
import { refreshAnimeRatings } from './anime-ratings.js';
import { fakeAniListFetch, type FakeAnime } from './fake-anilist.js';
import { fakeTmdbFetch } from './fake-tmdb.js';
import { JikanClient } from './jikan.js';
import { TmdbClient } from './tmdb.js';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

const ANILIST: FakeAnime[] = [
  {
    id: 7001,
    english: 'Love Story',
    romaji: 'Rabu Sutoorii',
    year: 2021,
    episodes: 12,
    genres: ['Comedy', 'Romance'],
    score: 72,
    popularity: 50_000,
    mal: { id: 9001, score: 8.12, rating: 'PG-13 - Teens 13 or older' },
    tags: [
      { name: 'School', rank: 90 },
      { name: 'Female Protagonist', rank: 70 },
      { name: 'Love Triangle', rank: 40 },
      { name: 'Amnesia', rank: 95, spoiler: true },
    ],
  },
  {
    id: 7002,
    english: 'Second Love',
    romaji: 'Sekando Rabu',
    year: 2022,
    episodes: 12,
    genres: ['Romance', 'Drama'],
    score: 80,
    popularity: 90_000,
    mal: { id: 9002, score: 7.4, rating: 'R - 17+ (violence & profanity)' },
    tags: [{ name: 'School', rank: 80 }],
  },
  {
    id: 7003,
    english: 'Punch Club',
    romaji: 'Panchi Kurabu',
    year: 2020,
    episodes: 24,
    genres: ['Action'],
    score: 85,
    popularity: 10_000,
  },
];

function setup() {
  const t = makeTestConfig();
  cleanups.push(t.cleanup);
  const handle = openDatabase(t.config.dbPath);
  cleanups.push(handle.close);
  const log: string[] = [];
  const fetcher = fakeAniListFetch(ANILIST, log);
  const tmdbFetch = fakeTmdbFetch({
    movies: [],
    shows: [{ id: 301, name: 'Love Story', year: 2021, seasons: [] }],
  });
  const deps = {
    db: handle.db,
    anilist: new AniListClient(fetcher, { minIntervalMs: 0 }),
    jikan: new JikanClient(fetcher, { minIntervalMs: 0 }),
    tmdb: new TmdbClient('key', tmdbFetch),
  };
  return { db: handle.db, deps, log };
}

function addShows(db: Db, shows: Array<{ title: string; anilistId: number; tmdbId?: number }>) {
  const libraryId = randomUUID();
  db.insert(schema.libraries)
    .values({ id: libraryId, name: 'Anime', kind: 'anime', createdAt: now(), updatedAt: now() })
    .run();
  return shows.map((s) => {
    const id = randomUUID();
    db.insert(schema.shows)
      .values({
        id,
        libraryId,
        title: s.title,
        sortTitle: s.title.toLowerCase(),
        anilistId: s.anilistId,
        tmdbId: s.tmdbId ?? null,
        needsReview: false,
        createdAt: now(),
        updatedAt: now(),
      })
      .run();
    return id;
  });
}

describe('anime ratings', () => {
  it('fetches AniList, MAL and TMDB scores, tags and age rating in one pass', async () => {
    const { db, deps, log } = setup();
    const [love] = addShows(db, [
      { title: 'Love Story', anilistId: 7001, tmdbId: 301 },
      { title: 'Second Love', anilistId: 7002 },
      { title: 'Punch Club', anilistId: 7003 },
    ]);
    expect(await refreshAnimeRatings(deps)).toEqual({ refreshed: 3, failed: 0 });
    // One AniList request for all three, then MAL for the two that have an id there.
    expect(log).toEqual(['ids:7001,7002,7003', 'mal:9001', 'mal:9002']);
    const row = db.select().from(schema.shows).where(eq(schema.shows.id, love!)).get()!;
    expect(JSON.parse(row.ratingsJson)).toEqual({ anilist: 7.2, mal: 8.12, tmdb: 8.1 });
    expect(JSON.parse(row.tagsJson)).toEqual(['School', 'Female Protagonist']);
    expect(row).toMatchObject({ malId: 9001, popularity: 50_000, ageRating: 'PG-13', rating: 7.2 });
    expect(row.ratingsRefreshedAt).not.toBeNull();

    // Fresh scores are left alone until they are a week old.
    log.length = 0;
    expect(await refreshAnimeRatings(deps)).toEqual({ refreshed: 0, failed: 0 });
    expect(log).toEqual([]);
  });

  it('lets the library be filtered by genre or tag and sorted by any score', async () => {
    const { db, deps } = setup();
    addShows(db, [
      { title: 'Love Story', anilistId: 7001 },
      { title: 'Second Love', anilistId: 7002 },
      { title: 'Punch Club', anilistId: 7003 },
    ]);
    await refreshAnimeRatings(deps);
    const items = new ItemsService(db);
    const titles = (q: {
      genre?: string;
      sort: 'title' | 'mal' | 'anilist' | 'popularity' | 'rating';
    }) =>
      items.list({ libraryKind: 'anime', offset: 0, limit: 50, ...q }).items.map((i) => i.title);

    expect(titles({ genre: 'romance', sort: 'mal' })).toEqual(['Love Story', 'Second Love']);
    expect(titles({ genre: 'Romance', sort: 'anilist' })).toEqual(['Second Love', 'Love Story']);
    expect(titles({ genre: 'romance,female protagonist', sort: 'title' })).toEqual(['Love Story']);
    // No MAL score sorts last.
    expect(titles({ sort: 'mal' })).toEqual(['Love Story', 'Second Love', 'Punch Club']);
    expect(titles({ sort: 'popularity' })).toEqual(['Second Love', 'Love Story', 'Punch Club']);
    expect(titles({ sort: 'rating' })).toEqual(['Punch Club', 'Second Love', 'Love Story']);

    const love = items.list({ libraryKind: 'anime', sort: 'title', offset: 0, limit: 50 })
      .items[0]!;
    expect(love.genres).toEqual(['Comedy', 'Romance']);
    expect(love.ratings).toEqual({ anilist: 7.2, mal: 8.12, tmdb: null });

    expect(items.facets('anime')).toEqual({
      genres: [
        { name: 'Romance', count: 2 },
        { name: 'Action', count: 1 },
        { name: 'Comedy', count: 1 },
        { name: 'Drama', count: 1 },
      ],
      tags: [{ name: 'School', count: 2 }],
    });
  });
});
