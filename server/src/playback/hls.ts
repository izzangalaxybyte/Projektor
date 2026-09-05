// HLS session lifecycle: start ffmpeg on first request, serve playlists and segments as they
// appear, stop idle sessions, and clean up their working directories.
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import {
  buildRemuxArgs,
  buildTranscodeArgs,
  fallbackHardware,
  HLS_SEGMENT_SECONDS,
  hlsNaming,
  segmentCount,
  vodPlaylist,
  type HardwareEncoder,
} from './ffmpeg-args.js';
import type { SubtitleTrack } from '../schemas/index.js';
import type { PlaybackSession, SessionRegistry } from './sessions.js';

/** The parts of an execa subprocess this module uses; execa's own generic type is unwieldy. */
interface FfmpegProcess extends Promise<{
  exitCode?: number | undefined;
  isTerminated?: boolean | undefined;
}> {
  kill(signal?: NodeJS.Signals): boolean;
  stderr?: NodeJS.ReadableStream | null;
}

interface Running {
  process: FfmpegProcess;
  exited: boolean;
  exitCode: number | null;
  stderr: string;
  /** First segment this run produces (transcode only; remux always starts at 0). */
  startSegment: number;
  /** How many times ffmpeg has been (re)started for the session. */
  starts: number;
  startedAt: number;
}

export class HlsError extends Error {
  constructor(
    public readonly statusCode: 404 | 501 | 503 | 504,
    message: string,
  ) {
    super(message);
  }
}

export interface HlsOptions {
  idleMs: number;
  maxProcesses: number;
  /** Cap on concurrent transcodes, which are far heavier than remuxes. */
  maxTranscodes: number;
  /** Hardware encoder to use for transcodes, or null for libx264. */
  hardware: HardwareEncoder;
  vaapiDevice?: string | undefined;
  /** Segments a player may request ahead of ffmpeg before we restart at the requested one. */
  seekAheadSegments?: number | undefined;
  /** How long a playlist or segment request waits for ffmpeg to produce the file. */
  waitMs: number;
}

export class HlsManager {
  private readonly running = new Map<string, Running>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(
    private readonly config: Config,
    private readonly registry: SessionRegistry,
    private readonly log: FastifyBaseLogger,
    private options: HlsOptions,
  ) {
    this.sweeper = setInterval(
      () => void this.sweep(),
      Math.min(15_000, Math.max(200, options.idleMs / 2)),
    );
    this.sweeper.unref();
  }

  /** Switches the encoder used by new transcodes; called after the startup self-test. */
  setHardware(encoder: HardwareEncoder): void {
    this.options.hardware = encoder;
  }

  get hardware(): HardwareEncoder {
    return this.options.hardware;
  }

  dir(sessionId: string): string {
    return path.join(this.config.transcodeDir, sessionId);
  }

  session(id: string): PlaybackSession {
    const s = this.registry.get(id);
    if (!s) throw new HlsError(404, 'No such playback session');
    return s;
  }

  /** The master playlist we author: one video variant plus a subtitle rendition per text track. */
  masterPlaylist(session: PlaybackSession, subtitles: SubtitleTrack[] = []): string {
    const bandwidth = Math.max(
      1_000_000,
      Math.round((session.decision.method === 'remux' ? 1.2 : 1.0) * 8_000_000),
    );
    const version = session.profile.hlsSegmentContainer === 'fmp4' ? 7 : 3;
    const lines = ['#EXTM3U', `#EXT-X-VERSION:${version}`, '#EXT-X-INDEPENDENT-SEGMENTS'];
    for (const sub of subtitles) {
      const name = subtitleName(sub);
      const lang = sub.language ? `,LANGUAGE="${sub.language}"` : '';
      lines.push(
        `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="${name}"${lang},DEFAULT=NO,AUTOSELECT=YES,FORCED=NO,URI="sub-${sub.id}.m3u8"`,
      );
    }
    const subsAttr = subtitles.length ? ',SUBTITLES="subs"' : '';
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth}${subsAttr}`, 'index.m3u8', '');
    return lines.join('\n');
  }

  /** A subtitle media playlist: the whole track as one WebVTT "segment" spanning the duration. */
  subtitlePlaylist(session: PlaybackSession, subtitleId: string): string {
    const seconds = Math.max(1, Math.ceil(session.durationMs / 1000));
    return [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      `#EXT-X-TARGETDURATION:${seconds}`,
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXT-X-PLAYLIST-TYPE:VOD',
      `#EXTINF:${seconds}.000,`,
      `sub-${subtitleId}.vtt`,
      '#EXT-X-ENDLIST',
      '',
    ].join('\n');
  }

  /** Starts ffmpeg for the session if it is not already running (optionally at a given segment). */
  async ensureStarted(session: PlaybackSession, startSegment?: number): Promise<void> {
    if (this.running.has(session.id)) return;
    const isTranscode = session.decision.method === 'transcode';
    const live = [...this.running.values()].filter((r) => !r.exited);
    if (live.length >= this.options.maxProcesses)
      throw new HlsError(503, 'Too many active streams; try again shortly');
    if (
      isTranscode &&
      live.filter((r) => this.registry.get(this.idOf(r))?.decision.method === 'transcode').length >=
        this.options.maxTranscodes
    ) {
      throw new HlsError(503, 'Too many active transcodes; try again shortly');
    }
    const outDir = this.dir(session.id);
    await mkdir(outDir, { recursive: true });
    const segment =
      startSegment ??
      (isTranscode ? Math.floor(session.startPositionMs / (HLS_SEGMENT_SECONDS * 1000)) : 0);
    const args = isTranscode
      ? buildTranscodeArgs(session, outDir, {
          startSegment: segment,
          hardware: this.hardwareFor(session.id),
          vaapiDevice: this.options.vaapiDevice ?? '/dev/dri/renderD128',
        })
      : buildRemuxArgs(session, outDir);
    const previous = this.starts.get(session.id) ?? 0;
    this.starts.set(session.id, previous + 1);
    const child = execa(this.config.ffmpegPath, args, {
      reject: false,
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'pipe',
    }) as unknown as FfmpegProcess;
    const run: Running = {
      process: child,
      exited: false,
      exitCode: null,
      stderr: '',
      startSegment: segment,
      starts: previous + 1,
      startedAt: Date.now(),
    };
    this.running.set(session.id, run);
    this.log.info(
      { sessionId: session.id, method: session.decision.method, startSegment: segment, args },
      'ffmpeg started',
    );
    child.stderr?.on(
      'data',
      (chunk: Buffer) => (run.stderr = (run.stderr + chunk.toString()).slice(-4000)),
    );
    void child.then(async (result) => {
      run.exited = true;
      run.exitCode = result.exitCode ?? null;
      const level = result.exitCode === 0 || result.isTerminated ? 'info' : 'warn';
      this.log[level](
        { sessionId: session.id, exitCode: result.exitCode, stderr: run.stderr },
        'ffmpeg exited',
      );
      // A transcode that died before writing anything is usually the GPU refusing the source
      // (10-bit decode, a missing tone-mapping filter). Try the next, more software-heavy path.
      const failedEarly =
        isTranscode &&
        !result.isTerminated &&
        result.exitCode !== 0 &&
        this.running.get(session.id) === run &&
        this.highestSegment(session) < 0;
      const next = failedEarly ? fallbackHardware(this.hardwareFor(session.id)) : undefined;
      if (next !== undefined) {
        this.sessionHardware.set(session.id, next);
        this.log.warn(
          { sessionId: session.id, from: this.hardwareFor(session.id), to: next },
          'transcode failed before its first segment; retrying with a different pipeline',
        );
        this.running.delete(session.id);
        await this.ensureStarted(session, segment).catch((error) =>
          this.log.warn({ sessionId: session.id, error: String(error) }, 'fallback start failed'),
        );
      }
    });
  }

  /** Per-session pipeline: the configured one until a failure demotes it. */
  private readonly sessionHardware = new Map<string, HardwareEncoder>();
  private hardwareFor(sessionId: string): HardwareEncoder {
    return this.sessionHardware.has(sessionId)
      ? this.sessionHardware.get(sessionId)!
      : this.options.hardware;
  }

  private readonly starts = new Map<string, number>();

  private idOf(run: Running): string {
    for (const [id, r] of this.running) if (r === run) return id;
    return '';
  }

  /** Number of ffmpeg starts for a session, for tests and diagnostics. */
  startCount(sessionId: string): number {
    return this.starts.get(sessionId) ?? 0;
  }

  /** Kills the current ffmpeg for a session (keeping produced segments) and starts at a segment. */
  private async restartAt(session: PlaybackSession, segment: number): Promise<void> {
    const run = this.running.get(session.id);
    this.running.delete(session.id);
    if (run && !run.exited) {
      run.process.kill('SIGTERM');
      await Promise.race([run.process, sleep(3000)]);
      if (!run.exited) run.process.kill('SIGKILL');
    }
    await this.ensureStarted(session, segment);
  }

  private highestSegment(session: PlaybackSession): number {
    const ext = hlsNaming(session.profile.hlsSegmentContainer).segmentExtension;
    let highest = -1;
    for (const name of readdirSyncSafe(this.dir(session.id))) {
      const m = new RegExp(`^seg-(\\d+)\\.${ext}$`).exec(name);
      if (m) highest = Math.max(highest, Number(m[1]));
    }
    return highest;
  }

  /** Returns the file's contents once ffmpeg has produced it, or throws 504/404. */
  async awaitFile(session: PlaybackSession, name: string): Promise<Buffer> {
    const match = /^(index\.m3u8|init\.mp4|seg-(\d+)\.(ts|m4s))$/.exec(name);
    if (!match) throw new HlsError(404, 'No such segment');
    const isTranscode = session.decision.method === 'transcode';

    if (isTranscode && name === 'index.m3u8') {
      // The playlist is known up front; start ffmpeg so the first segment is ready sooner.
      await this.ensureStarted(session);
      return Buffer.from(vodPlaylist(session.durationMs, session.profile.hlsSegmentContainer));
    }
    await this.ensureStarted(session);
    const file = path.join(this.dir(session.id), name);
    const requested = match[2] !== undefined ? Number(match[2]) : null;

    if (isTranscode && requested !== null) {
      if (requested >= segmentCount(session.durationMs))
        throw new HlsError(404, 'Segment past the end');
      if (!existsSync(file)) {
        const run = this.running.get(session.id)!;
        const produced = this.highestSegment(session);
        const ahead = this.options.seekAheadSegments ?? 3;
        const behind = requested < run.startSegment;
        // The run writes nextSegment next; only a request beyond that plus the window restarts.
        const nextSegment = Math.max(produced, run.startSegment - 1) + 1;
        const farAhead = requested > nextSegment + ahead;
        if (behind || farAhead || run.exited) {
          this.log.info(
            { sessionId: session.id, requested, produced, from: run.startSegment },
            'seek: restarting ffmpeg',
          );
          await this.restartAt(session, requested);
        }
      }
    }

    let run = this.running.get(session.id)!;
    const deadline = Date.now() + this.options.waitMs;
    while (!existsSync(file)) {
      // A failed transcode may have been replaced by a fallback run; follow the newest one.
      run = this.running.get(session.id) ?? run;
      if (run.exited && this.running.get(session.id) === run)
        throw new HlsError(
          404,
          run.exitCode === 0
            ? 'Segment does not exist'
            : `ffmpeg failed: ${run.stderr.trim().split('\n').pop() ?? 'unknown error'}`,
        );
      if (Date.now() > deadline)
        throw new HlsError(504, 'Timed out waiting for the stream to start');
      await sleep(100);
    }
    if (!isTranscode && name === 'index.m3u8') return this.remuxPlaylist(run, file);
    return readFile(file);
  }

  /**
   * A remux finishes far faster than real time, so for the first few seconds we wait for ffmpeg's
   * ENDLIST and hand players a VOD playlist. Long files fall back to the growing EVENT playlist,
   * which players treat as live-ish but still seekable within what exists.
   */
  private async remuxPlaylist(run: Running, file: string): Promise<Buffer> {
    const holdUntil = run.startedAt + REMUX_VOD_HOLD_MS;
    for (;;) {
      const body = await readFile(file);
      if (run.exited || body.includes('#EXT-X-ENDLIST') || Date.now() > holdUntil) return body;
      await sleep(150);
    }
  }

  contentType(name: string): string {
    if (name.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
    if (name.endsWith('.ts')) return 'video/mp2t';
    if (name.endsWith('.m4s')) return 'video/iso.segment';
    return 'video/mp4';
  }

  async stop(sessionId: string): Promise<void> {
    const run = this.running.get(sessionId);
    this.running.delete(sessionId);
    this.starts.delete(sessionId);
    this.sessionHardware.delete(sessionId);
    this.registry.remove(sessionId);
    if (run && !run.exited) {
      run.process.kill('SIGTERM');
      await Promise.race([run.process, sleep(3000)]);
      if (!run.exited) run.process.kill('SIGKILL');
    }
    await rm(this.dir(sessionId), { recursive: true, force: true });
  }

  /** Stops sessions nobody has touched for idleMs. */
  async sweep(): Promise<void> {
    const cutoff = Date.now() - this.options.idleMs;
    for (const s of this.registry.list()) {
      if (s.lastAccessAt < cutoff) {
        this.log.info({ sessionId: s.id }, 'stopping idle playback session');
        await this.stop(s.id);
      }
    }
  }

  async close(): Promise<void> {
    clearInterval(this.sweeper);
    await Promise.all(this.registry.list().map((s) => this.stop(s.id)));
  }
}

/** How long the first remux playlist request waits for ffmpeg to finish before serving it live. */
const REMUX_VOD_HOLD_MS = 8_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readdirSyncSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
export { hlsNaming };

function subtitleName(sub: SubtitleTrack): string {
  const base = sub.title ?? sub.language ?? sub.format;
  return base.replace(/"/g, "'");
}

/**
 * Appends ?access_token= to every URI in a playlist when the client authenticated with a query
 * token, since players resolve segment URLs relative to the playlist without its query string.
 */
export function withToken(playlist: string, token: string | undefined): string {
  if (!token) return playlist;
  const q = `?access_token=${encodeURIComponent(token)}`;
  return playlist
    .split('\n')
    .map((line) => {
      if (line.startsWith('#'))
        return line.replace(/URI="([^"]+)"/g, (_m, uri: string) => `URI="${uri}${q}"`);
      return line.trim() ? `${line}${q}` : line;
    })
    .join('\n');
}
