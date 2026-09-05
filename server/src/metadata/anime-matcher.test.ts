import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { now, openDatabase, schema, type Db } from '../db/index.js';
import { ImageStore } from '../images/store.js';
import { makeTestConfig } from '../test-utils.js';
import { AniListClient, stripHtml } from './anilist.js';
import { AnimeMatcher } from './anime-matcher.js';
import { fakeAniListFetch } from './fake-anilist.js';
import { fakeTmdbFetch } from './fake-tmdb.js';
import { TmdbClient } from './tmdb.js';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

const ANILIST = [
  { id: 5001, english: 'Sample Anime', romaji: 'Sanpuru Anime', year: 2020, episodes: 37 },
  { id: 5002, english: null, romaji: 'Unrelated Thing', year: 2001, episodes: 12 },
];
const TMDB = {
  movies: [],
  shows: [
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
};

function setup(withTmdb = true) {
  const t = makeTestConfig();
  cleanups.push(t.cleanup);
  const handle = openDatabase(t.config.dbPath);
  cleanups.push(handle.close);
  const anilistLog: string[] = [];
  const anilistFetch = fakeAniListFetch(ANILIST, anilistLog);
  const tmdbFetch = fakeTmdbFetch(TMDB);
  const images = new ImageStore(t.config.imagesDir, (url) =>
    url.includes('anilist') ? anilistFetch(url) : tmdbFetch(url),
  );
  const matcher = new AnimeMatcher({
    db: handle.db,
    anilist: new AniListClient(anilistFetch),
    tmdb: withTmdb ? new TmdbClient('key', tmdbFetch) : null,
    images,
  });
  return { db: handle.db, matcher, anilistLog };
}

function addAnimeShow(db: Db, title: string, absolutes: number[], seasonOffset = 0): string {
  const libraryId = randomUUID();
  db.insert(schema.libraries)
    .values({ id: libraryId, name: 'Anime', kind: 'anime', createdAt: now(), updatedAt: now() })
    .run();
  const showId = randomUUID();
  db.insert(schema.shows)
    .values({
      id: showId,
      libraryId,
      title,
      sortTitle: title.toLowerCase(),
      seasonOffset,
      createdAt: now(),
      updatedAt: now(),
    })
    .run();
  for (const n of absolutes) {
    db.insert(schema.episodes)
      .values({ id: randomUUID(), showId, absoluteNumber: n, createdAt: now(), updatedAt: now() })
      .run();
  }
  return showId;
}

const episodesOf = (db: Db, showId: string) =>
  db
    .select()
    .from(schema.episodes)
    .where(eq(schema.episodes.showId, showId))
    .all()
    .sort((a, b) => a.absoluteNumber! - b.absoluteNumber!)
    .map((e) => [e.absoluteNumber, e.seasonNumber, e.episodeNumber, e.title]);

describe('stripHtml', () => {
  it('turns AniList markup into plain text', () => {
    expect(stripHtml('Line one<br><br><i>two</i> &amp; three')).toBe('Line one\n\ntwo & three');
    expect(stripHtml(null)).toBeNull();
  });
});

describe('AnimeMatcher', () => {
  it('matches on AniList, then maps absolute episodes onto TMDB seasons and fills titles', async () => {
    const { db, matcher } = setup();
    const showId = addAnimeShow(db, 'Sample Anime', [1, 12, 13, 37, 99]);
    expect(await matcher.matchShow(showId)).toBe(true);
    const show = db.select().from(schema.shows).where(eq(schema.shows.id, showId)).get()!;
    expect(show).toMatchObject({
      anilistId: 5001,
      tmdbId: 301,
      title: 'Sample Anime',
      year: 2020,
      needsReview: false,
      rating: 8.5,
    });
    expect(show.overview).toContain('About Sanpuru Anime');
    expect(show.overview).not.toContain('<');
    expect(show.posterKey).toMatch(/^[a-f0-9]{40}$/);
    expect(episodesOf(db, showId)).toEqual([
      [1, 1, 1, 'S1 Ep 1'],
      [12, 1, 12, 'S1 Ep 12'],
      [13, 2, 1, 'S2 Ep 1'],
      [37, 2, 25, 'S2 Ep 25'],
      [99, null, null, null],
    ]);
    const seasons = db.select().from(schema.seasons).where(eq(schema.seasons.showId, showId)).all();
    expect(seasons.map((s) => s.seasonNumber).sort()).toEqual([1, 2]);
  });

  it('honours the per-show season offset', async () => {
    const { db, matcher } = setup();
    const showId = addAnimeShow(db, 'Sample Anime', [1, 2], 12);
    await matcher.matchShow(showId);
    expect(episodesOf(db, showId)).toEqual([
      [1, 2, 1, 'S2 Ep 1'],
      [2, 2, 2, 'S2 Ep 2'],
    ]);
  });

  it('works without a TMDB key: AniList metadata only, episodes stay absolute', async () => {
    const { db, matcher } = setup(false);
    const showId = addAnimeShow(db, 'Sample Anime', [1, 13]);
    expect(await matcher.matchShow(showId)).toBe(true);
    const show = db.select().from(schema.shows).where(eq(schema.shows.id, showId)).get()!;
    expect(show).toMatchObject({ anilistId: 5001, tmdbId: null, needsReview: false });
    expect(episodesOf(db, showId)).toEqual([
      [1, null, null, null],
      [13, null, null, null],
    ]);
  });

  it('leaves weak matches for review and only attempts anime libraries once', async () => {
    const { db, matcher, anilistLog } = setup();
    const showId = addAnimeShow(db, 'Nothing Like This At All', [1]);
    expect(await matcher.matchPending()).toEqual({ matched: 0, unmatched: 1, failed: 0 });
    expect(db.select().from(schema.shows).where(eq(schema.shows.id, showId)).get()!).toMatchObject({
      needsReview: true,
      anilistId: null,
    });
    expect(await matcher.matchPending()).toEqual({ matched: 0, unmatched: 0, failed: 0 });
    expect(anilistLog).toHaveLength(1);
  });
});
