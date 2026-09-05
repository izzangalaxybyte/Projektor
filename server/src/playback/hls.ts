// HLS session lifecycle: start ffmpeg on first request, serve playlists and segments as they
// appear, stop idle sessions, and clean up their working directories.
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import { buildRemuxArgs, hlsNaming } from './ffmpeg-args.js';
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
    private readonly options: HlsOptions,
    private readonly argsFor: (session: PlaybackSession, outDir: string) => string[] = defaultArgs,
  ) {
    this.sweeper = setInterval(
      () => void this.sweep(),
      Math.min(15_000, Math.max(200, options.idleMs / 2)),
    );
    this.sweeper.unref();
  }

  dir(sessionId: string): string {
    return path.join(this.config.transcodeDir, sessionId);
  }

  session(id: string): PlaybackSession {
    const s = this.registry.get(id);
    if (!s) throw new HlsError(404, 'No such playback session');
    return s;
  }

  /** The master playlist we author; it points at ffmpeg's index playlist. */
  masterPlaylist(session: PlaybackSession): string {
    const bandwidth = Math.max(
      1_000_000,
      Math.round((session.decision.method === 'remux' ? 1.2 : 1.0) * 8_000_000),
    );
    const version = session.profile.hlsSegmentContainer === 'fmp4' ? 7 : 3;
    return [
      '#EXTM3U',
      `#EXT-X-VERSION:${version}`,
      '#EXT-X-INDEPENDENT-SEGMENTS',
      `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth}`,
      'index.m3u8',
      '',
    ].join('\n');
  }

  /** Starts ffmpeg for the session if it is not already running. */
  async ensureStarted(session: PlaybackSession): Promise<void> {
    if (this.running.has(session.id)) return;
    const live = [...this.running.values()].filter((r) => !r.exited).length;
    if (live >= this.options.maxProcesses)
      throw new HlsError(503, 'Too many active streams; try again shortly');
    const outDir = this.dir(session.id);
    await mkdir(outDir, { recursive: true });
    const args = this.argsFor(session, outDir);
    const child = execa(this.config.ffmpegPath, args, {
      reject: false,
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'pipe',
    }) as unknown as FfmpegProcess;
    const run: Running = { process: child, exited: false, exitCode: null, stderr: '' };
    this.running.set(session.id, run);
    this.log.info(
      { sessionId: session.id, method: session.decision.method, args },
      'ffmpeg started',
    );
    child.stderr?.on(
      'data',
      (chunk: Buffer) => (run.stderr = (run.stderr + chunk.toString()).slice(-4000)),
    );
    void child.then((result) => {
      run.exited = true;
      run.exitCode = result.exitCode ?? null;
      const level = result.exitCode === 0 || result.isTerminated ? 'info' : 'warn';
      this.log[level](
        { sessionId: session.id, exitCode: result.exitCode, stderr: run.stderr },
        'ffmpeg exited',
      );
    });
  }

  /** Returns the file's contents once ffmpeg has produced it, or throws 504/404. */
  async awaitFile(session: PlaybackSession, name: string): Promise<Buffer> {
    if (!/^(index\.m3u8|init\.mp4|seg-\d+\.(ts|m4s))$/.test(name))
      throw new HlsError(404, 'No such segment');
    await this.ensureStarted(session);
    const file = path.join(this.dir(session.id), name);
    const run = this.running.get(session.id)!;
    const deadline = Date.now() + this.options.waitMs;
    while (!existsSync(file)) {
      if (run.exited)
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
    return readFile(file);
  }

  contentType(name: string): string {
    if (name.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
    if (name.endsWith('.ts')) return 'video/mp2t';
    if (name.endsWith('.m4s')) return 'video/iso.segment';
    return 'video/mp4';
  }

  isFinished(sessionId: string): boolean {
    return this.running.get(sessionId)?.exited ?? false;
  }

  async stop(sessionId: string): Promise<void> {
    const run = this.running.get(sessionId);
    this.running.delete(sessionId);
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

function defaultArgs(session: PlaybackSession, outDir: string): string[] {
  if (session.decision.method === 'remux') return buildRemuxArgs(session, outDir);
  throw new HlsError(501, 'Transcoding is not available yet');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export { hlsNaming };
