import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { now, openDatabase, schema, type Db } from '../db/index.js';
import { makeTestConfig } from '../test-utils.js';
import { ProgressService } from './service.js';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

function setup() {
  const t = makeTestConfig();
  cleanups.push(t.cleanup);
  const handle = openDatabase(t.config.dbPath);
  cleanups.push(handle.close);
  const db = handle.db;
  const userId = randomUUID();
  db.insert(schema.users)
    .values({
      id: userId,
      name: 'U',
      pinHash: 'x',
      avatarColor: '#000000',
      createdAt: now(),
      updatedAt: now(),
    })
    .run();
  const libraryId = randomUUID();
  db.insert(schema.libraries)
    .values({ id: libraryId, name: 'TV', kind: 'tv', createdAt: now(), updatedAt: now() })
    .run();
  return { db, userId, libraryId, service: new ProgressService(db) };
}

function addShow(
  db: Db,
  libraryId: string,
  episodes: Array<[season: number | null, episode: number | null, absolute: number | null]>,
): string[] {
  const showId = randomUUID();
  db.insert(schema.shows)
    .values({
      id: showId,
      libraryId,
      title: 'S',
      sortTitle: 's',
      createdAt: now(),
      updatedAt: now(),
    })
    .run();
  return episodes.map(([seasonNumber, episodeNumber, absoluteNumber]) => {
    const id = randomUUID();
    db.insert(schema.episodes)
      .values({
        id,
        showId,
        seasonNumber,
        episodeNumber,
        absoluteNumber,
        createdAt: now(),
        updatedAt: now(),
      })
      .run();
    return id;
  });
}

describe('ProgressService', () => {
  it('records positions, marks watched at 90%, and keeps watched afterwards', () => {
    const { db, userId, libraryId, service } = setup();
    const [ep] = addShow(db, libraryId, [[1, 1, null]]);
    expect(service.update(userId, ep!, 30_000, 100_000)).toMatchObject({
      positionMs: 30_000,
      watched: false,
    });
    expect(service.continueWatching(userId)).toEqual([ep]);
    expect(service.update(userId, ep!, 91_000, 100_000).watched).toBe(true);
    expect(service.continueWatching(userId)).toEqual([]);
    // Rewatching from the start keeps the watched flag.
    expect(service.update(userId, ep!, 1_000, 100_000).watched).toBe(true);
    expect(service.setWatched(userId, ep!, false)).toBeNull();
    expect(service.get(userId, ep!)).toBeNull();
    expect(service.setWatched(userId, ep!, true)).toMatchObject({ watched: true });
  });

  it('rejects unknown items', () => {
    const { userId, service } = setup();
    expect(() => service.update(userId, 'nope', 1, 2)).toThrow(/movies and episodes/);
  });

  it('orders continue watching by recency and separates users', () => {
    const { db, userId, libraryId, service } = setup();
    const [a, b] = addShow(db, libraryId, [
      [1, 1, null],
      [1, 2, null],
    ]);
    service.update(userId, a!, 10, 100);
    db.update(schema.playbackState).set({ updatedAt: '2020-01-01T00:00:00.000Z' }).run();
    service.update(userId, b!, 10, 100);
    expect(service.continueWatching(userId)).toEqual([b, a]);
    const other = randomUUID();
    db.insert(schema.users)
      .values({
        id: other,
        name: 'O',
        pinHash: 'x',
        avatarColor: '#000000',
        createdAt: now(),
        updatedAt: now(),
      })
      .run();
    expect(service.continueWatching(other)).toEqual([]);
  });

  it('finds the next episode across seasons and by absolute number', () => {
    const { db, libraryId, service } = setup();
    const [s1e1, s1e2, s2e1, special] = addShow(db, libraryId, [
      [1, 1, null],
      [1, 2, null],
      [2, 1, null],
      [0, 1, null],
    ]);
    expect(service.nextEpisode(special!)).toBe(s1e1);
    expect(service.nextEpisode(s1e1!)).toBe(s1e2);
    expect(service.nextEpisode(s1e2!)).toBe(s2e1);
    expect(service.nextEpisode(s2e1!)).toBeNull();
    const [a1, a2, a3] = addShow(db, libraryId, [
      [null, null, 1],
      [null, null, 13],
      [null, null, 2],
    ]);
    expect(service.nextEpisode(a1!)).toBe(a3);
    expect(service.nextEpisode(a3!)).toBe(a2);
    expect(service.nextEpisode(a2!)).toBeNull();
    expect(() => service.nextEpisode('nope')).toThrow();
  });
});
