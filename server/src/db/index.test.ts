import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTestConfig } from '../test-utils.js';
import { openDatabase } from './index.js';

const EXPECTED_TABLES = [
  'iptv_episodes',
  'iptv_movies',
  'iptv_series',
  'live_categories',
  'live_channels',
  'live_programmes',
  'users',
  'sessions',
  'libraries',
  'library_paths',
  'movies',
  'shows',
  'seasons',
  'episodes',
  'media_files',
  'streams',
  'subtitles',
  'playback_state',
  'settings',
];

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

function tableNames(sqlite: ReturnType<typeof openDatabase>['sqlite']): string[] {
  return sqlite
    .prepare(
      "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%'",
    )
    .all()
    .map((r) => (r as { name: string }).name);
}

describe('openDatabase', () => {
  it('creates the database file and every table on first start', () => {
    const t = makeTestConfig();
    cleanups.push(t.cleanup);
    expect(existsSync(t.config.dbPath)).toBe(false);
    const handle = openDatabase(t.config.dbPath);
    cleanups.push(handle.close);
    expect(existsSync(t.config.dbPath)).toBe(true);
    expect(tableNames(handle.sqlite).sort()).toEqual([...EXPECTED_TABLES].sort());
    expect(handle.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(handle.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
  });

  it('is a no-op on second start and keeps existing rows', () => {
    const t = makeTestConfig();
    cleanups.push(t.cleanup);
    const first = openDatabase(t.config.dbPath);
    first.sqlite
      .prepare('insert into settings (key, value, updated_at) values (?, ?, ?)')
      .run('k', 'v', new Date().toISOString());
    const migrationsBefore = first.sqlite
      .prepare('select count(*) c from __drizzle_migrations')
      .get() as { c: number };
    first.close();

    const second = openDatabase(t.config.dbPath);
    cleanups.push(second.close);
    const migrationsAfter = second.sqlite
      .prepare('select count(*) c from __drizzle_migrations')
      .get() as { c: number };
    expect(migrationsAfter.c).toBe(migrationsBefore.c);
    expect(second.sqlite.prepare('select value from settings where key = ?').get('k')).toEqual({
      value: 'v',
    });
  });
});
