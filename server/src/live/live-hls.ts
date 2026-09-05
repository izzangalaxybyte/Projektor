// Live HLS: ffmpeg copies the relayed MPEG-TS into a sliding-window playlist for players that
// cannot take a raw TS stream (browsers, AVPlayer). Video is copied; audio becomes stereo AAC so
// MP2 and AC-3 channels play everywhere.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import { HlsError } from '../playback/hls.js';
import { LiveStreamError, type LiveRelayManager, type Subscription } from './relay.js';

export const LIVE_SEGMENT_SECONDS = 4;
export const LIVE_WINDOW_SEGMENTS = 6;

interface FfmpegProcess extends Promise<{
  exitCode?: number | undefined;
  isTerminated?: boolean | undefined;
}> {
  kill(signal?: NodeJS.Signals): boolean;
  stderr?: NodeJS.ReadableStream | null;
  stdin?: NodeJS.WritableStream | null;
}

export interface LiveSession {
  id: string;
  channelId: string;
  createdAt: number;
  lastAccessAt: number;
}

interface Running {
  process: FfmpegProcess;
  subscription: Subscription;
  exited: boolean;
  exitCode: number | null;
  stderr: string;
}

export interface LiveHlsOptions {
  idleMs: number;
  waitMs: number;
}

export function buildLiveHlsArgs(outDir: string): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-fflags',
    '+genpts+discardcorrupt',
    '-i',
    'pipe:0',
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-ac',
    '2',
    '-b:a',
    '160k',
    '-sn',
    '-dn',
    '-f',
    'hls',
    '-hls_time',
    String(LIVE_SEGMENT_SECONDS),
    '-hls_list_size',
    String(LIVE_WINDOW_SEGMENTS),
    '-hls_flags',
    'delete_segments+independent_segments+temp_file',
    '-hls_segment_type',
    'mpegts',
    '-hls_segment_filename',
    `${outDir}/seg-%d.ts`,
    `${outDir}/index.m3u8`,
  ];
}

export class LiveHlsManager {
  private readonly sessions = new Map<string, LiveSession>();
  private readonly running = new Map<string, Running>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(
    private readonly config: Config,
    private readonly relays: LiveRelayManager,
    private readonly log: FastifyBaseLogger,
    private readonly options: LiveHlsOptions,
  ) {
    this.sweeper = setInterval(
      () => void this.sweep(),
      Math.min(15_000, Math.max(200, options.idleMs / 2)),
    );
    this.sweeper.unref();
  }

  dir(sessionId: string): string {
    return path.join(this.config.transcodeDir, `live-${sessionId}`);
  }

  create(channelId: string): LiveSession {
    const now = Date.now();
    const session: LiveSession = { id: randomUUID(), channelId, createdAt: now, lastAccessAt: now };
    this.sessions.set(session.id, session);
    return session;
  }

  session(id: string): LiveSession {
    const s = this.sessions.get(id);
    if (!s) throw new HlsError(404, 'No such live session');
    s.lastAccessAt = Date.now();
    return s;
  }

  list(): LiveSession[] {
    return [...this.sessions.values()];
  }

  private async ensureStarted(session: LiveSession): Promise<Running> {
    const existing = this.running.get(session.id);
    if (existing) return existing;
    const outDir = this.dir(session.id);
    await mkdir(outDir, { recursive: true });
    const subscription = this.relays.subscribe(session.channelId);
    const args = buildLiveHlsArgs(outDir);
    const child = execa(this.config.ffmpegPath, args, {
      reject: false,
      stdin: 'pipe',
      stdout: 'ignore',
      stderr: 'pipe',
    }) as unknown as FfmpegProcess;
    const run: Running = {
      process: child,
      subscription,
      exited: false,
      exitCode: null,
      stderr: '',
    };
    this.running.set(session.id, run);
    this.log.info(
      { sessionId: session.id, channelId: session.channelId, args },
      'live ffmpeg started',
    );
    child.stderr?.on(
      'data',
      (chunk: Buffer) => (run.stderr = (run.stderr + chunk.toString()).slice(-4000)),
    );
    const stdin = child.stdin;
    if (stdin) {
      stdin.on('error', () => undefined); // EPIPE when ffmpeg quits first
      subscription.stream.pipe(stdin);
    }
    void child.then((result) => {
      run.exited = true;
      run.exitCode = result.exitCode ?? null;
      subscription.close();
      const level = result.exitCode === 0 || result.isTerminated ? 'info' : 'warn';
      this.log[level](
        { sessionId: session.id, exitCode: result.exitCode, stderr: run.stderr },
        'live ffmpeg exited',
      );
    });
    return run;
  }

  /** Returns the playlist or a segment once ffmpeg has written it. */
  async awaitFile(session: LiveSession, name: string): Promise<Buffer> {
    if (!/^(index\.m3u8|seg-\d+\.ts)$/.test(name)) throw new HlsError(404, 'No such segment');
    const run = await this.ensureStarted(session);
    try {
      await run.subscription.ready;
    } catch (error) {
      await this.stop(session.id);
      throw error instanceof LiveStreamError ? error : new LiveStreamError(502, String(error));
    }
    const file = path.join(this.dir(session.id), name);
    const deadline = Date.now() + this.options.waitMs;
    while (!existsSync(file)) {
      if (run.exited)
        throw new HlsError(
          404,
          run.exitCode === 0
            ? 'The stream has ended'
            : `ffmpeg failed: ${run.stderr.trim().split('\n').pop() ?? 'unknown error'}`,
        );
      if (Date.now() > deadline)
        throw new HlsError(504, 'Timed out waiting for the channel to start');
      await sleep(100);
    }
    return readFile(file);
  }

  contentType(name: string): string {
    return name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t';
  }

  async stop(sessionId: string): Promise<void> {
    const run = this.running.get(sessionId);
    this.running.delete(sessionId);
    this.sessions.delete(sessionId);
    if (run) {
      run.subscription.close();
      if (!run.exited) {
        run.process.kill('SIGTERM');
        await Promise.race([run.process, sleep(3000)]);
        if (!run.exited) run.process.kill('SIGKILL');
      }
    }
    await rm(this.dir(sessionId), { recursive: true, force: true });
  }

  async sweep(): Promise<void> {
    const cutoff = Date.now() - this.options.idleMs;
    for (const s of this.sessions.values()) {
      if (s.lastAccessAt < cutoff) {
        this.log.info({ sessionId: s.id }, 'stopping idle live session');
        await this.stop(s.id);
      }
    }
  }

  async close(): Promise<void> {
    clearInterval(this.sweeper);
    await Promise.all(this.list().map((s) => this.stop(s.id)));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
