import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { now, schema, type Db } from '../db/index.js';
import { walkVideos } from './walker.js';

export interface ScanResult {
  filesSeen: number;
  /** New or modified files. These have probedAt reset to null and need probing. */
  filesChanged: number;
  filesMissing: number;
  /** Ids of files that need probing (new or changed). */
  changedFileIds: string[];
}

/**
 * Walks every path of a library and reconciles media_files with what is on disk.
 * Unchanged files (same size and mtime) are left alone. Files that disappeared are
 * flagged missing rather than deleted so playback state survives moves.
 */
export async function scanLibrary(
  db: Db,
  libraryId: string,
  log?: FastifyBaseLogger,
): Promise<ScanResult> {
  const paths = db
    .select({ path: schema.libraryPaths.path })
    .from(schema.libraryPaths)
    .where(eq(schema.libraryPaths.libraryId, libraryId))
    .all()
    .map((r) => r.path);

  const known = new Map(
    db
      .select({
        id: schema.mediaFiles.id,
        path: schema.mediaFiles.path,
        sizeBytes: schema.mediaFiles.sizeBytes,
        mtimeMs: schema.mediaFiles.mtimeMs,
        missing: schema.mediaFiles.missing,
      })
      .from(schema.mediaFiles)
      .where(eq(schema.mediaFiles.libraryId, libraryId))
      .all()
      .map((r) => [r.path, r]),
  );

  const result: ScanResult = { filesSeen: 0, filesChanged: 0, filesMissing: 0, changedFileIds: [] };
  const seen = new Set<string>();

  for (const root of paths) {
    for await (const file of walkVideos(root, {
      onError: (where, error) => log?.warn({ where, error }, 'scan: skipping unreadable path'),
    })) {
      result.filesSeen += 1;
      seen.add(file.path);
      const existing = known.get(file.path);
      const ts = now();
      if (!existing) {
        const id = randomUUID();
        db.insert(schema.mediaFiles)
          .values({
            id,
            libraryId,
            path: file.path,
            fileName: file.fileName,
            sizeBytes: file.sizeBytes,
            mtimeMs: file.mtimeMs,
            createdAt: ts,
            updatedAt: ts,
          })
          .run();
        result.filesChanged += 1;
        result.changedFileIds.push(id);
        continue;
      }
      const changed = existing.sizeBytes !== file.sizeBytes || existing.mtimeMs !== file.mtimeMs;
      if (changed) {
        db.update(schema.mediaFiles)
          .set({
            sizeBytes: file.sizeBytes,
            mtimeMs: file.mtimeMs,
            probedAt: null,
            missing: false,
            updatedAt: ts,
          })
          .where(eq(schema.mediaFiles.id, existing.id))
          .run();
        result.filesChanged += 1;
        result.changedFileIds.push(existing.id);
      } else if (existing.missing) {
        db.update(schema.mediaFiles)
          .set({ missing: false, updatedAt: ts })
          .where(eq(schema.mediaFiles.id, existing.id))
          .run();
      }
    }
  }

  for (const [filePath, row] of known) {
    if (seen.has(filePath) || row.missing) continue;
    db.update(schema.mediaFiles)
      .set({ missing: true, updatedAt: now() })
      .where(eq(schema.mediaFiles.id, row.id))
      .run();
    result.filesMissing += 1;
  }

  db.update(schema.libraries)
    .set({ lastScannedAt: now(), updatedAt: now() })
    .where(eq(schema.libraries.id, libraryId))
    .run();
  return result;
}
