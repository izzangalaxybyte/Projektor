import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { now, openDatabase, schema } from '../db/index.js';
import { makeTestConfig } from '../test-utils.js';
import { ItemsService } from './service.js';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

describe('ItemsService.list', () => {
  it('lists a season in episode order with runtimes, falling back to the file length', () => {
    const t = makeTestConfig();
    cleanups.push(t.cleanup);
    const { db, close } = openDatabase(t.config.dbPath);
    cleanups.push(close);
    const ts = now();
    const libraryId = randomUUID();
    const showId = randomUUID();
    const seasonId = randomUUID();
    db.insert(schema.libraries)
      .values({ id: libraryId, name: 'A', kind: 'anime', createdAt: ts, updatedAt: ts })
      .run();
    db.insert(schema.shows)
      .values({
        id: showId,
        libraryId,
        title: 'Blue Box',
        sortTitle: 'blue box',
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
    db.insert(schema.seasons)
      .values({
        id: seasonId,
        showId,
        seasonNumber: 1,
        title: 'Season 1',
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
    // Titles in reverse alphabetical order of their numbers, as TMDB names them.
    const episodes: Array<[number, string, number | null]> = [
      [2, 'Zebra Crossing', 1_380_000],
      [1, 'Yesterday', null],
      [10, 'A Chance to Blossom', null],
    ];
    for (const [n, title, runtimeMs] of episodes) {
      const id = randomUUID();
      db.insert(schema.episodes)
        .values({
          id,
          showId,
          seasonId,
          seasonNumber: 1,
          episodeNumber: n,
          title,
          runtimeMs,
          createdAt: ts,
          updatedAt: ts,
        })
        .run();
      db.insert(schema.mediaFiles)
        .values({
          id: randomUUID(),
          libraryId,
          path: `/m/${n}.mkv`,
          fileName: `${n}.mkv`,
          sizeBytes: 1,
          mtimeMs: 1,
          durationMs: 1_420_000 + n,
          episodeId: id,
          createdAt: ts,
          updatedAt: ts,
        })
        .run();
    }
    const page = new ItemsService(db).list({
      parentId: seasonId,
      sort: 'title',
      offset: 0,
      limit: 50,
    });
    expect(page.items.map((i) => [i.episodeNumber, i.title, i.runtimeMs])).toEqual([
      [1, 'Yesterday', 1_420_001],
      [2, 'Zebra Crossing', 1_380_000],
      [10, 'A Chance to Blossom', 1_420_010],
    ]);
  });
});
