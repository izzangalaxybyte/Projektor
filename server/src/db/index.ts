import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

export interface DatabaseHandle {
  db: Db;
  sqlite: Database.Database;
  close(): void;
}

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../drizzle',
);

/** Opens (creating if needed) the SQLite database at dbPath and applies pending migrations. */
export function openDatabase(dbPath: string): DatabaseHandle {
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return { db, sqlite, close: () => sqlite.close() };
}

export { schema };

export const now = (): string => new Date().toISOString();
