import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { now, openDatabase, schema } from '../db/index.js';
import { ItemsService } from '../items/service.js';
import { makeTestConfig } from '../test-utils.js';
import { FavoriteError, FavoritesService } from './service.js';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

function seed() {
  const t = makeTestConfig();
  cleanups.push(t.cleanup);
  const { db, close } = openDatabase(t.config.dbPath);
  cleanups.push(close);
  const ts = now();
  const ids = {
    alice: randomUUID(),
    bob: randomUUID(),
    library: randomUUID(),
    show: randomUUID(),
    season: randomUUID(),
    episode: randomUUID(),
  };
  for (const [id, name] of [
    [ids.alice, 'Alice'],
    [ids.bob, 'Bob'],
  ] as const)
    db.insert(schema.users)
      .values({ id, name, pinHash: 'x', avatarColor: '#000', createdAt: ts, updatedAt: ts })
      .run();
  db.insert(schema.libraries)
    .values({ id: ids.library, name: 'TV', kind: 'tv', createdAt: ts, updatedAt: ts })
    .run();
  db.insert(schema.shows)
    .values({
      id: ids.show,
      libraryId: ids.library,
      title: 'Show',
      sortTitle: 'show',
      createdAt: ts,
      updatedAt: ts,
    })
    .run();
  db.insert(schema.seasons)
    .values({
      id: ids.season,
      showId: ids.show,
      seasonNumber: 1,
      title: 'Season 1',
      createdAt: ts,
      updatedAt: ts,
    })
    .run();
  db.insert(schema.episodes)
    .values({
      id: ids.episode,
      showId: ids.show,
      seasonId: ids.season,
      seasonNumber: 1,
      episodeNumber: 1,
      title: 'Pilot',
      createdAt: ts,
      updatedAt: ts,
    })
    .run();
  const favorites = new FavoritesService(db);
  return { ids, favorites, items: new ItemsService(db, undefined, undefined, favorites) };
}

describe('FavoritesService', () => {
  it('favorites a show for one user and shows it on summaries', () => {
    const { ids, favorites, items } = seed();
    expect(favorites.set(ids.alice, ids.show, true)).toBe(true);
    expect(favorites.set(ids.alice, ids.show, true)).toBe(true);
    expect(favorites.list(ids.alice)).toEqual([ids.show]);
    expect(favorites.list(ids.bob)).toEqual([]);
    expect(items.get(ids.show, ids.alice).favorite).toBe(true);
    expect(items.get(ids.show, ids.bob).favorite).toBe(false);
    expect(
      items.list({ libraryKind: 'tv', sort: 'title', offset: 0, limit: 10 }, ids.alice).items[0]
        ?.favorite,
    ).toBe(true);

    expect(favorites.set(ids.alice, ids.show, false)).toBe(false);
    expect(favorites.list(ids.alice)).toEqual([]);
    expect(items.get(ids.show, ids.alice).favorite).toBe(false);
  });

  it('rejects episodes and unknown ids', () => {
    const { ids, favorites } = seed();
    expect(() => favorites.set(ids.alice, ids.episode, true)).toThrow(FavoriteError);
    expect(() => favorites.set(ids.alice, 'nope', true)).toThrow(FavoriteError);
  });
});
