// Text subtitles for a media file: embedded tracks found by ffprobe and sidecar files beside
// the media. Both are converted to WebVTT with ffmpeg on first request and cached; the first
// request for an embedded track converts all of the file's tracks in one pass. ASS and SSA
// tracks are also served as they are, with the file's attached fonts, for libass on the clients.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
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
/** Formats the clients render themselves with libass, styling and all, from the raw track. */
export const ASS_FORMATS = new Set(['ass', 'ssa']);
const FONT_TYPES: Record<string, string> = {
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.ttc': 'font/collection',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** A font attached to the media file (MKV attachments), cached under DATA_DIR/subtitles. */
export interface SubtitleFont {
  name: string;
  path: string;
  contentType: string;
}

export class SubtitleError extends Error {
  constructor(
    public readonly statusCode: 404 | 500,
    message: string,
  ) {
    super(message);
  }
}

export class SubtitleService {
  /** Files whose embedded tracks are being extracted, so concurrent requests share one pass. */
  private readonly extracting = new Map<string, Promise<void>>();

  constructor(
    private readonly db: Db,
    private readonly config: Pick<Config, 'ffmpegPath' | 'ffprobePath' | 'subtitlesDir'>,
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
        assUrl: ASS_FORMATS.has(s.format) ? `/api/subtitles/${s.id}.ass` : null,
        fontsUrl: ASS_FORMATS.has(s.format) ? `/api/subtitles/${s.id}/fonts` : null,
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
    if (sub.source === 'embedded') {
      await this.extractEmbedded(sub.fileId, file.path);
      const done = this.db
        .select({ vttPath: schema.subtitles.vttPath })
        .from(schema.subtitles)
        .where(eq(schema.subtitles.id, sub.id))
        .get()?.vttPath;
      if (done && existsSync(done)) return done;
    }
    // A sidecar, or a track the shared pass could not convert: this one alone.
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
    await writeFile(out, cleanVtt(await readFile(out, 'utf8')));
    this.db
      .update(schema.subtitles)
      .set({ vttPath: out, updatedAt: now() })
      .where(eq(schema.subtitles.id, sub.id))
      .run();
    return out;
  }

  /** Path to the untouched ASS script for an ASS or SSA subtitle, extracted the first time. */
  async ensureAss(subtitleId: string): Promise<string> {
    const { sub, file } = this.lookup(subtitleId);
    if (!ASS_FORMATS.has(sub.format)) throw new SubtitleError(404, 'Not an ASS subtitle');
    const outDir = path.join(this.config.subtitlesDir, sub.fileId);
    const out = path.join(outDir, `${sub.id}.ass`);
    if (existsSync(out)) return out;
    if (sub.source === 'embedded') {
      await this.extractEmbedded(sub.fileId, file.path);
      if (existsSync(out)) return out;
    }
    await mkdir(outDir, { recursive: true });
    // ffmpeg undoes the zlib compression some MKVs use on subtitle tracks; copying keeps every
    // style, override tag and drawing as the author wrote them.
    const input = sub.source === 'embedded' ? file.path : sub.sourcePath!;
    const tmp = `${out}.${randomUUID()}.tmp`;
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', input];
    args.push('-map', sub.source === 'embedded' ? `0:${sub.streamIndex}` : '0:s:0');
    args.push('-c:s', 'copy', '-f', 'ass', tmp);
    const result = await execa(this.config.ffmpegPath, args, {
      reject: false,
      timeout: 120_000,
      stdin: 'ignore',
    });
    if (result.exitCode !== 0 || !existsSync(tmp)) {
      this.log?.warn({ subtitleId, stderr: result.stderr }, 'ASS extraction failed');
      throw new SubtitleError(500, 'Subtitle extraction failed');
    }
    await rename(tmp, out);
    return out;
  }

  /**
   * Converts every embedded text track of a file that is not cached yet, WebVTT for all and the
   * untouched script for ASS and SSA, in a single ffmpeg pass. Each track on its own costs a read
   * of the whole file, so a fansub release with dozens of tracks took most of a minute track by
   * track before a phone download could even start. Tracks the pass misses (ffmpeg gives up on
   * every output when one fails) fall back to the one-track conversions.
   */
  private extractEmbedded(fileId: string, mediaPath: string): Promise<void> {
    let run = this.extracting.get(fileId);
    if (!run) {
      run = this.runExtraction(fileId, mediaPath).finally(() => this.extracting.delete(fileId));
      this.extracting.set(fileId, run);
    }
    return run;
  }

  private async runExtraction(fileId: string, mediaPath: string): Promise<void> {
    const subs = this.db
      .select()
      .from(schema.subtitles)
      .where(and(eq(schema.subtitles.fileId, fileId), eq(schema.subtitles.source, 'embedded')))
      .all();
    const outDir = path.join(this.config.subtitlesDir, fileId);
    const jobs: Array<{ subId: string; tmp: string; out: string; vtt: boolean }> = [];
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', mediaPath];
    for (const sub of subs) {
      const add = (vtt: boolean) => {
        const out = path.join(outDir, `${sub.id}.${vtt ? 'vtt' : 'ass'}`);
        const tmp = `${out}.${randomUUID()}.tmp`;
        args.push('-map', `0:${sub.streamIndex}`);
        args.push(...(vtt ? ['-f', 'webvtt'] : ['-c:s', 'copy', '-f', 'ass']), tmp);
        jobs.push({ subId: sub.id, tmp, out, vtt });
      };
      if (!(sub.vttPath && existsSync(sub.vttPath))) add(true);
      if (ASS_FORMATS.has(sub.format) && !existsSync(path.join(outDir, `${sub.id}.ass`)))
        add(false);
    }
    if (jobs.length === 0) return;
    await mkdir(outDir, { recursive: true });
    const result = await execa(this.config.ffmpegPath, args, {
      reject: false,
      timeout: 300_000,
      stdin: 'ignore',
    });
    if (result.exitCode !== 0)
      this.log?.warn({ fileId, stderr: result.stderr }, 'subtitle extraction pass failed');
    for (const job of jobs) {
      if (result.exitCode !== 0 || !existsSync(job.tmp)) {
        await rm(job.tmp, { force: true });
        continue;
      }
      if (!job.vtt) {
        await rename(job.tmp, job.out);
        continue;
      }
      await writeFile(job.out, cleanVtt(await readFile(job.tmp, 'utf8')));
      await rm(job.tmp, { force: true });
      this.db
        .update(schema.subtitles)
        .set({ vttPath: job.out, updatedAt: now() })
        .where(eq(schema.subtitles.id, job.subId))
        .run();
    }
  }

  /**
   * Fonts attached to the subtitle's media file, which ASS styles name and VLC loads. They are
   * dumped once per file; an empty list means the file has none.
   */
  async fonts(subtitleId: string): Promise<SubtitleFont[]> {
    const { sub, file } = this.lookup(subtitleId);
    if (!ASS_FORMATS.has(sub.format)) throw new SubtitleError(404, 'Not an ASS subtitle');
    const dir = path.join(this.config.subtitlesDir, sub.fileId, 'fonts');
    const manifest = path.join(dir, 'fonts.json');
    if (!existsSync(manifest)) await this.dumpFonts(file.path, dir, manifest);
    const listed = JSON.parse(await readFile(manifest, 'utf8')) as Array<{
      name: string;
      file: string;
    }>;
    return listed.map((f) => ({
      name: f.name,
      path: path.join(dir, f.file),
      contentType: FONT_TYPES[path.extname(f.file)] ?? 'application/octet-stream',
    }));
  }

  private lookup(subtitleId: string) {
    const sub = this.db
      .select()
      .from(schema.subtitles)
      .where(eq(schema.subtitles.id, subtitleId))
      .get();
    if (!sub) throw new SubtitleError(404, 'No such subtitle');
    const file = this.db
      .select()
      .from(schema.mediaFiles)
      .where(eq(schema.mediaFiles.id, sub.fileId))
      .get();
    if (!file) throw new SubtitleError(404, 'No such file');
    return { sub, file };
  }

  private async dumpFonts(mediaPath: string, dir: string, manifest: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    const probe = await execa(
      this.config.ffprobePath,
      ['-v', 'error', '-select_streams', 't', '-show_streams', '-of', 'json', mediaPath],
      { reject: false, timeout: 60_000, stdin: 'ignore' },
    );
    const streams =
      probe.exitCode === 0
        ? ((JSON.parse(probe.stdout) as { streams?: AttachmentStream[] }).streams ?? [])
        : [];
    // Files are saved by position, never by the attachment's own file name, which the MKV sets.
    const fonts = streams
      .map((s) => ({ index: s.index, name: s.tags?.filename ?? '', ext: fontExtension(s) }))
      .filter((f): f is { index: number; name: string; ext: string } => f.ext !== null)
      .map((f, i) => ({ ...f, file: `${i}${f.ext}` }));
    if (fonts.length) {
      const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y'];
      for (const f of fonts) args.push(`-dump_attachment:${f.index}`, path.join(dir, f.file));
      // ffmpeg writes the attachments while opening the input, then stops for want of an output.
      await execa(this.config.ffmpegPath, [...args, '-i', mediaPath], {
        reject: false,
        timeout: 120_000,
        stdin: 'ignore',
      });
    }
    const dumped = fonts.filter((f) => existsSync(path.join(dir, f.file)));
    if (dumped.length < fonts.length)
      this.log?.warn({ mediaPath, missing: fonts.length - dumped.length }, 'font dump incomplete');
    await writeFile(
      manifest,
      JSON.stringify(dumped.map((f) => ({ name: f.name || f.file, file: f.file }))),
    );
  }
}

interface AttachmentStream {
  index: number;
  codec_name?: string;
  tags?: Record<string, string>;
}

/** The extension a font attachment is saved under, or null when it is not a font. */
function fontExtension(s: AttachmentStream): string | null {
  const ext = path.extname(s.tags?.filename ?? '').toLowerCase();
  if (ext in FONT_TYPES) return ext;
  const mime = (s.tags?.mimetype ?? '').toLowerCase();
  if (s.codec_name === 'otf' || mime.includes('opentype') || mime.endsWith('/otf')) return '.otf';
  if (s.codec_name === 'ttf' || mime.includes('font') || mime.includes('truetype')) return '.ttf';
  return null;
}

/**
 * Tidies ffmpeg's ASS-to-WebVTT output. It keeps override blocks it does not understand
 * ("{=74}" from Aegisub) as text, and a sign drawn with \p1 becomes its vector path ("m 0 0 l 100
 * 0 100 50"), which players show as junk. Cues left empty are dropped.
 */
export function cleanVtt(vtt: string): string {
  const blocks = vtt.replace(/\r\n/g, '\n').split(/\n{2,}/);
  const kept: string[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const timing = lines.findIndex((l) => l.includes('-->'));
    if (timing === -1) {
      kept.push(block);
      continue;
    }
    const text = lines
      .slice(timing + 1)
      .map((l) => l.replace(/\{[^}]*\}/g, ''))
      .filter(
        (l) =>
          !/^\s*(?:<[^>]+>)*\s*m\s+-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?(?:\s+[mlbspc]?\s*-?\d+(?:\.\d+)?)*\s*(?:<\/[^>]+>)*\s*$/i.test(
            l,
          ),
      );
    if (text.some((l) => l.replace(/<[^>]+>/g, '').trim() !== '')) {
      kept.push([...lines.slice(0, timing + 1), ...text].join('\n'));
    }
  }
  return kept.join('\n\n').trimEnd() + '\n';
}
