import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import pLimit from 'p-limit';
import { now, schema, type Db } from '../db/index.js';
import { probeFile } from './ffprobe.js';

export interface ProbeOptions {
  ffprobePath: string;
  concurrency?: number;
  log?: FastifyBaseLogger;
}

export interface ProbeSummary {
  probed: number;
  failed: number;
}

/**
 * Probes the given media files with bounded concurrency and stores container, duration,
 * bitrate, and streams. A failed probe still sets probedAt (with the error in probeJson) so
 * a broken file is not retried on every scan; a rescan after the file changes clears it.
 */
export async function probeFiles(
  db: Db,
  fileIds: string[],
  options: ProbeOptions,
): Promise<ProbeSummary> {
  if (fileIds.length === 0) return { probed: 0, failed: 0 };
  const limit = pLimit(options.concurrency ?? 4);
  const files = db
    .select({ id: schema.mediaFiles.id, path: schema.mediaFiles.path })
    .from(schema.mediaFiles)
    .where(inArray(schema.mediaFiles.id, fileIds))
    .all();

  const summary: ProbeSummary = { probed: 0, failed: 0 };
  await Promise.all(
    files.map((file) =>
      limit(async () => {
        try {
          const result = await probeFile(options.ffprobePath, file.path);
          db.transaction((tx) => {
            tx.update(schema.mediaFiles)
              .set({
                container: result.container,
                durationMs: result.durationMs,
                bitrate: result.bitrate,
                probeJson: JSON.stringify(result.raw),
                probedAt: now(),
                updatedAt: now(),
              })
              .where(eq(schema.mediaFiles.id, file.id))
              .run();
            tx.delete(schema.streams).where(eq(schema.streams.fileId, file.id)).run();
            if (result.streams.length > 0) {
              tx.insert(schema.streams)
                .values(
                  result.streams.map((s) => ({
                    id: randomUUID(),
                    fileId: file.id,
                    streamIndex: s.index,
                    type: s.type,
                    codec: s.codec,
                    language: s.language,
                    title: s.title,
                    isDefault: s.isDefault,
                    isForced: s.isForced,
                    width: s.width,
                    height: s.height,
                    channels: s.channels,
                  })),
                )
                .run();
            }
          });
          summary.probed += 1;
        } catch (error) {
          summary.failed += 1;
          options.log?.warn({ path: file.path, error: String(error) }, 'probe failed');
          db.update(schema.mediaFiles)
            .set({
              probeJson: JSON.stringify({ error: String(error) }),
              probedAt: now(),
              updatedAt: now(),
            })
            .where(eq(schema.mediaFiles.id, file.id))
            .run();
        }
      }),
    ),
  );
  return summary;
}
