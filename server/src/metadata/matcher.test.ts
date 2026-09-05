import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { now, openDatabase, schema, type Db } from '../db/index.js';
import { ImageStore } from '../images/store.js';
import { makeTestConfig } from '../test-utils.js';
import { fakeTmdbFetch, type FakeTmdbData } from './fake-tmdb.js';
import { Matcher } from './matcher.js';
import { TmdbClient } from './tmdb.js';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

const DATA: FakeTmdbData = {
  movies: [
    { id: 101, title: 'Heat', year: 1995, genres: ['Crime', 'Thriller'], runtime: 170 },
    { id: 102, title: 'Heat', year: 2023 },
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
        { number: 2, episodes: [{ number: 1, name: 'Return' }] },
      ],
    },
  ],
};

function setup(credential = 'key') {
  const t = makeTestConfig();
  cleanups.push(t.cleanup);
  const handle = openDatabase(t.config.dbPath);
  cleanups.push(handle.close);
  const calls: string[] = [];
  const fetcher = fakeTmdbFetch(DATA, calls);
  const matcher = new Matcher({
    db: handle.db,
    tmdb: new TmdbClient(credential, fetcher),
    images: new ImageStore(t.config.imagesDir, fetcher),
  });
  return { db: handle.db, matcher, calls, config: t.config };
}

function addLibrary(db: Db, kind: 'movie' | 'tv' | 'anime'): string {
  const id = randomUUID();
  db.insert(schema.libraries)
    .values({ id, name: kind, kind, createdAt: now(), updatedAt: now() })
    .run();
  return id;
}
function addMovie(db: Db, libraryId: string, title: string, year: number | null): string {
  const id = randomUUID();
  db.insert(schema.movies)
    .values({
      id,
      libraryId,
      title,
      sortTitle: title.toLowerCase(),
      year,
      createdAt: now(),
      updatedAt: now(),
    })
    .run();
  return id;
}
function addShow(
  db: Db,
  libraryId: string,
  title: string,
  seasons: Array<[number, number[]]>,
): string {
  const showId = randomUUID();
  db.insert(schema.shows)
    .values({
      id: showId,
      libraryId,
      title,
      sortTitle: title.toLowerCase(),
      createdAt: now(),
      updatedAt: now(),
    })
    .run();
  for (const [seasonNumber, episodes] of seasons) {
    const seasonId = randomUUID();
    db.insert(schema.seasons)
      .values({ id: seasonId, showId, seasonNumber, createdAt: now(), updatedAt: now() })
      .run();
    for (const episodeNumber of episodes) {
      db.insert(schema.episodes)
        .values({
          id: randomUUID(),
          showId,
          seasonId,
          seasonNumber,
          episodeNumber,
          createdAt: now(),
          updatedAt: now(),
        })
        .run();
    }
  }
  return showId;
}

describe('Matcher', () => {
  it('matches a movie, fills metadata, caches artwork, and clears needsReview', async () => {
    const { db, matcher, config } = setup();
    const lib = addLibrary(db, 'movie');
    const id = addMovie(db, lib, 'Heat', 1995);
    expect(await matcher.matchMovie(id)).toBe(true);
    const movie = db.select().from(schema.movies).where(eq(schema.movies.id, id)).get()!;
    expect(movie).toMatchObject({
      tmdbId: 101,
      needsReview: false,
      year: 1995,
      runtimeMs: 170 * 60_000,
      tagline: 'A tagline',
    });
    expect(JSON.parse(movie.genresJson)).toEqual(['Crime', 'Thriller']);
    expect(movie.posterKey).toMatch(/^[a-f0-9]{40}$/);
    expect(existsSync(new ImageStore(config.imagesDir).originalPath(movie.posterKey!))).toBe(true);
    expect(movie.matchAttemptedAt).not.toBeNull();
  });

  it('leaves a weak match in needs-review but records the attempt', async () => {
    const { db, matcher } = setup();
    const lib = addLibrary(db, 'movie');
    const id = addMovie(db, lib, 'some random download', 2021);
    expect(await matcher.matchMovie(id)).toBe(false);
    const movie = db.select().from(schema.movies).where(eq(schema.movies.id, id)).get()!;
    expect(movie).toMatchObject({ tmdbId: null, needsReview: true });
    expect(movie.matchAttemptedAt).not.toBeNull();
  });

  it('matches a show and fills seasons and episodes we have files for', async () => {
    const { db, matcher, calls } = setup();
    const lib = addLibrary(db, 'tv');
    const showId = addShow(db, lib, 'Sample Show', [[1, [2]]]);
    expect(await matcher.matchShow(showId)).toBe(true);
    const show = db.select().from(schema.shows).where(eq(schema.shows.id, showId)).get()!;
    expect(show).toMatchObject({ tmdbId: 201, needsReview: false, year: 2018 });
    const season = db.select().from(schema.seasons).where(eq(schema.seasons.showId, showId)).get()!;
    expect(season.title).toBe('Season 1');
    expect(season.posterKey).toMatch(/^[a-f0-9]{40}$/);
    const episode = db
      .select()
      .from(schema.episodes)
      .where(eq(schema.episodes.showId, showId))
      .get()!;
    expect(episode).toMatchObject({
      title: 'The Second One',
      airDate: '2018-02-02',
      runtimeMs: 45 * 60_000,
      tmdbId: 201102,
    });
    // Only season 1 was fetched; season 2 has no local files.
    expect(calls.filter((c) => c.startsWith('/3/tv/201/season/'))).toEqual(
      expect.arrayContaining(['/3/tv/201/season/1?api_key=key']),
    );
    expect(calls.some((c) => c.startsWith('/3/tv/201/season/2'))).toBe(false);
  });

  it('matchPending covers movies and tv shows, skips anime, and is not repeated', async () => {
    const { db, matcher } = setup();
    const movies = addLibrary(db, 'movie');
    const tv = addLibrary(db, 'tv');
    const anime = addLibrary(db, 'anime');
    addMovie(db, movies, 'Sample Movie', 2019);
    addMovie(db, movies, 'Nothing Like This', null);
    addShow(db, tv, 'Sample Show', [[2, [1]]]);
    const animeShow = addShow(db, anime, 'Sample Anime', []);
    expect(await matcher.matchPending()).toEqual({ matched: 2, unmatched: 1, failed: 0 });
    expect(
      db.select().from(schema.shows).where(eq(schema.shows.id, animeShow)).get()!.matchAttemptedAt,
    ).toBeNull();
    expect(await matcher.matchPending()).toEqual({ matched: 0, unmatched: 0, failed: 0 });
  });

  it('reports failures when the key is rejected', async () => {
    const { db, matcher } = setup('bad');
    const lib = addLibrary(db, 'movie');
    addMovie(db, lib, 'Heat', 1995);
    expect(await matcher.matchPending()).toEqual({ matched: 0, unmatched: 0, failed: 1 });
  });
});
