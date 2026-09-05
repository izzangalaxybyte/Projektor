// Text subtitles for a media file: embedded tracks found by ffprobe and sidecar files beside
// the media. Both are converted to WebVTT with ffmpeg on first request and cached.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { execa } from 'execa';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import { now, schema, type Db } from '../db/index.js';
import type { SubtitleTrack } from '../schemas/index.js';

/** Codecs ffmpeg can turn into WebVTT. Bitmap formats (pgs, dvd_subtitle) are excluded. */
export const TEXT_SUBTITLE_CODECS = new Set([
  'subrip',
  'srt',
  'ass',
  'ssa',
  'mov_text',
  'webvtt',
  'text',
]);
const SIDECAR_EXTENSIONS = new Set(['.srt', '.ass', '.ssa', '.vtt']);

export class SubtitleError extends Error {
  constructor(
    public readonly statusCode: 404 | 500,
    message: string,
  ) {
    super(message);
  }
}

export class SubtitleService {
  constructor(
    private readonly db: Db,
    private readonly config: Pick<Config, 'ffmpegPath' | 'subtitlesDir'>,
    private readonly log?: FastifyBaseLogger,
  ) {}

  /** Re-lists embedded and sidecar subtitles for the given files, keeping cached conversions. */
  async discover(fileIds: string[]): Promise<number> {
    if (fileIds.length === 0) return 0;
    const files = this.db
      .select()
      .from(schema.mediaFiles)
      .where(inArray(schema.mediaFiles.id, fileIds))
      .all();
    let found = 0;
    for (const file of files) {
      const existing = this.db
        .select()
        .from(schema.subtitles)
        .where(eq(schema.subtitles.fileId, file.id))
        .all();
      const keep = new Set<string>();
      const upsert = (
        row: Omit<
          typeof schema.subtitles.$inferInsert,
          'id' | 'createdAt' | 'updatedAt' | 'fileId'
        >,
      ) => {
        const match = existing.find(
          (e) =>
            e.source === row.source &&
            e.streamIndex === (row.streamIndex ?? null) &&
            e.sourcePath === (row.sourcePath ?? null),
        );
        if (match) {
          keep.add(match.id);
          this.db
            .update(schema.subtitles)
            .set({ language: row.language, title: row.title, format: row.format, updatedAt: now() })
            .where(eq(schema.subtitles.id, match.id))
            .run();
        } else {
          this.db
            .insert(schema.subtitles)
            .values({
              id: randomUUID(),
              fileId: file.id,
              createdAt: now(),
              updatedAt: now(),
              ...row,
            })
            .run();
        }
        found += 1;
      };

      const streams = this.db
        .select()
        .from(schema.streams)
        .where(and(eq(schema.streams.fileId, file.id), eq(schema.streams.type, 'subtitle')))
        .all();
      for (const s of streams) {
        if (!TEXT_SUBTITLE_CODECS.has(s.codec)) continue;
        upsert({
          source: 'embedded',
          streamIndex: s.streamIndex,
          sourcePath: null,
          language: s.language,
          title: s.title,
          format: s.codec,
        });
      }
      for (const sidecar of await this.sidecars(file.path)) {
        upsert({
          source: 'external',
          streamIndex: null,
          sourcePath: sidecar.path,
          language: sidecar.language,
          title: sidecar.title,
          format: sidecar.format,
        });
      }
      const stale = existing.filter((e) => !keep.has(e.id) && e.source !== 'opensubtitles');
      if (stale.length)
        this.db
          .delete(schema.subtitles)
          .where(
            inArray(
              schema.subtitles.id,
              stale.map((e) => e.id),
            ),
          )
          .run();
    }
    return found;
  }

  /** Sidecar files: same base name as the media, optional language code, text subtitle extension. */
  private async sidecars(
    mediaPath: string,
  ): Promise<Array<{ path: string; language: string | null; title: string; format: string }>> {
    const dir = path.dirname(mediaPath);
    const base = path.basename(mediaPath, path.extname(mediaPath));
    const entries = await readdir(dir).catch(() => [] as string[]);
    const out = [];
    for (const name of entries) {
      const ext = path.extname(name).toLowerCase();
      if (!SIDECAR_EXTENSIONS.has(ext) || !name.startsWith(base)) continue;
      const between = name.slice(base.length, name.length - ext.length);
      // "" | ".en" | ".eng" | ".en.forced" style suffixes
      const parts = between.split('.').filter(Boolean);
      if (parts.length > 2) continue;
      const language = parts[0] && /^[a-z]{2,3}$/i.test(parts[0]) ? parts[0].toLowerCase() : null;
      const forced = parts.some((p) => /^forced$/i.test(p));
      out.push({
        path: path.join(dir, name),
        language,
        title: forced ? 'Forced' : between ? between.slice(1) : 'External',
        format: ext.slice(1) === 'srt' ? 'subrip' : ext.slice(1),
      });
    }
    return out;
  }

  list(fileId: string): SubtitleTrack[] {
    return this.db
      .select()
      .from(schema.subtitles)
      .where(eq(schema.subtitles.fileId, fileId))
      .orderBy(asc(schema.subtitles.source), asc(schema.subtitles.streamIndex))
      .all()
      .map((s) => ({
        id: s.id,
        source: s.source,
        streamIndex: s.streamIndex,
        language: s.language,
        title: s.title,
        format: s.format,
        url: `/api/subtitles/${s.id}.vtt`,
      }));
  }

  /** Path to the WebVTT for a subtitle, converting with ffmpeg the first time. */
  async ensureVtt(subtitleId: string): Promise<string> {
    const sub = this.db
      .select()
      .from(schema.subtitles)
      .where(eq(schema.subtitles.id, subtitleId))
      .get();
    if (!sub) throw new SubtitleError(404, 'No such subtitle');
    if (sub.vttPath && existsSync(sub.vttPath)) return sub.vttPath;
    const file = this.db
      .select()
      .from(schema.mediaFiles)
      .where(eq(schema.mediaFiles.id, sub.fileId))
      .get();
    if (!file) throw new SubtitleError(404, 'No such file');
    const outDir = path.join(this.config.subtitlesDir, sub.fileId);
    await mkdir(outDir, { recursive: true });
    const out = path.join(outDir, `${sub.id}.vtt`);
    const input = sub.source === 'embedded' ? file.path : sub.sourcePath!;
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', input];
    if (sub.source === 'embedded') args.push('-map', `0:${sub.streamIndex}`);
    args.push('-f', 'webvtt', out);
    const result = await execa(this.config.ffmpegPath, args, {
      reject: false,
      timeout: 120_000,
      stdin: 'ignore',
    });
    if (result.exitCode !== 0 || !existsSync(out)) {
      this.log?.warn({ subtitleId, stderr: result.stderr }, 'subtitle conversion failed');
      throw new SubtitleError(500, 'Subtitle conversion failed');
    }
    this.db
      .update(schema.subtitles)
      .set({ vttPath: out, updatedAt: now() })
      .where(eq(schema.subtitles.id, sub.id))
      .run();
    return out;
  }
}
