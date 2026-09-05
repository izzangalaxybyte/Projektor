import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { now, schema, type Db } from '../db/index.js';
import type { Library, LibraryKind } from '../schemas/index.js';

export class LibraryError extends Error {
  constructor(
    public readonly statusCode: 400 | 404,
    message: string,
  ) {
    super(message);
  }
}

export class LibraryService {
  constructor(private readonly db: Db) {}

  list(): Library[] {
    const rows = this.db.select().from(schema.libraries).orderBy(schema.libraries.name).all();
    const paths = this.db.select().from(schema.libraryPaths).all();
    return rows.map((row) =>
      this.toLibrary(
        row,
        paths.filter((p) => p.libraryId === row.id).map((p) => p.path),
      ),
    );
  }

  get(id: string): Library {
    const row = this.db.select().from(schema.libraries).where(eq(schema.libraries.id, id)).get();
    if (!row) throw new LibraryError(404, 'No such library');
    const paths = this.db
      .select({ path: schema.libraryPaths.path })
      .from(schema.libraryPaths)
      .where(eq(schema.libraryPaths.libraryId, id))
      .all()
      .map((p) => p.path);
    return this.toLibrary(row, paths);
  }

  /** Creates a library. Every path must be an existing, readable directory. */
  async create(input: { name: string; kind: LibraryKind; paths: string[] }): Promise<Library> {
    const resolved = [...new Set(input.paths.map((p) => path.resolve(p)))];
    for (const p of resolved) {
      const info = await stat(p).catch(() => null);
      if (!info?.isDirectory()) throw new LibraryError(400, `Not a directory: ${p}`);
    }
    const ts = now();
    const id = randomUUID();
    this.db.transaction((tx) => {
      tx.insert(schema.libraries)
        .values({ id, name: input.name, kind: input.kind, createdAt: ts, updatedAt: ts })
        .run();
      tx.insert(schema.libraryPaths)
        .values(resolved.map((p) => ({ id: randomUUID(), libraryId: id, path: p })))
        .run();
    });
    return this.get(id);
  }

  /** Deletes a library and, through cascades, its files, items, and streams. */
  delete(id: string): void {
    const result = this.db.delete(schema.libraries).where(eq(schema.libraries.id, id)).run();
    if (result.changes === 0) throw new LibraryError(404, 'No such library');
  }

  private toLibrary(row: typeof schema.libraries.$inferSelect, paths: string[]): Library {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      paths,
      createdAt: row.createdAt,
      lastScannedAt: row.lastScannedAt,
    };
  }
}
