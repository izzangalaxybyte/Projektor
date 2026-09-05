// Records live channels: a relay subscriber that writes the MPEG-TS bytes to a file, a scheduler
// that starts due recordings and stops finished ones, and restart recovery.
import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, statSync, type WriteStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { execa } from 'execa';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import { now, schema, type Db } from '../db/index.js';
import type { CreateRecordingRequest, Recording } from '../schemas/index.js';
import { LiveStreamError, type LiveRelayManager, type Subscription } from './relay.js';
import type { LiveService } from './service.js';

export class RecordingError extends Error {
  constructor(
    public readonly statusCode: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

interface Active {
  subscription: Subscription;
  file: WriteStream;
  bytes: number;
  stopping: boolean;
  onData?: (chunk: Buffer) => void;
}

export interface RecorderOptions {
  /** How often the scheduler looks for due starts and stops. */
  tickMs: number;
  paddingMs: number;
}

export class RecordingManager {
  private readonly active = new Map<string, Active>();
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly relays: LiveRelayManager,
    private readonly live: LiveService,
    private readonly log: FastifyBaseLogger,
    private readonly options: RecorderOptions,
  ) {}

  /** Marks recordings cut off by a crash as failed (files kept) and starts the scheduler. */
  start(): void {
    const orphans = this.db
      .select()
      .from(schema.recordings)
      .where(eq(schema.recordings.state, 'recording'))
      .all();
    for (const r of orphans) {
      const size = r.filePath && existsSync(r.filePath) ? statSizeSync(r.filePath) : 0;
      this.db
        .update(schema.recordings)
        .set({
          state: 'failed',
          error: 'The server restarted while this was recording; what was captured is kept',
          actualEndAt: now(),
          sizeBytes: size,
          updatedAt: now(),
        })
        .where(eq(schema.recordings.id, r.id))
        .run();
      this.log.warn({ recordingId: r.id, title: r.title }, 'recording cut off by a restart');
    }
    this.stop();
    this.timer = setInterval(() => void this.tick(), this.options.tickMs);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  list(state?: Recording['state']): Recording[] {
    return this.db
      .select()
      .from(schema.recordings)
      .where(state ? eq(schema.recordings.state, state) : undefined)
      .orderBy(desc(schema.recordings.startAt))
      .all()
      .map(toRecording);
  }

  get(id: string): Recording | null {
    const row = this.db.select().from(schema.recordings).where(eq(schema.recordings.id, id)).get();
    return row ? toRecording(row) : null;
  }

  /** Absolute path of a recording's file, if it has started. */
  filePath(id: string): string | null {
    return (
      this.db
        .select({ p: schema.recordings.filePath })
        .from(schema.recordings)
        .where(eq(schema.recordings.id, id))
        .get()?.p ?? null
    );
  }

  /** Creates a recording: now, at a time, or for a guide programme. Due ones start on the next tick. */
  async create(request: CreateRecordingRequest, userId: string | null): Promise<Recording> {
    const channel = this.live.channel(request.channelId);
    if (!channel) throw new RecordingError(404, 'No such channel');
    const nowMs = Date.now();
    let startAt: number;
    let endAt: number | null;
    let title = request.title ?? null;
    let description: string | null = null;
    let programmeId: string | null = null;
    if (request.programmeId !== undefined) {
      const found = this.live.programme(request.programmeId);
      if (!found || found.channel.id !== channel.id)
        throw new RecordingError(404, 'No such programme on this channel');
      const p = found.programme;
      const end = new Date(p.endAt).getTime();
      if (end <= nowMs)
        throw new RecordingError(400, 'That programme has already finished; use catch-up');
      startAt = Math.max(nowMs, new Date(p.startAt).getTime());
      endAt = end + (request.paddingMs ?? this.options.paddingMs);
      title ??= p.title;
      description = p.description;
      programmeId = p.id;
    } else {
      startAt = request.startAt ? new Date(request.startAt).getTime() : nowMs;
      if (Number.isNaN(startAt)) throw new RecordingError(400, 'Bad startAt');
      if (startAt < nowMs - 60_000) throw new RecordingError(400, 'startAt is in the past');
      endAt = request.durationMinutes ? startAt + request.durationMinutes * 60_000 : null;
      title ??=
        channel.now && startAt <= nowMs
          ? channel.now.title
          : `${channel.name} ${formatStamp(new Date(startAt))}`;
    }
    const ts = now();
    const id = randomUUID();
    this.db
      .insert(schema.recordings)
      .values({
        id,
        channelId: channel.id,
        channelName: channel.name,
        channelLogoUrl: channel.logoUrl,
        title,
        description,
        programmeId,
        startAt: new Date(startAt).toISOString(),
        endAt: endAt === null ? null : new Date(endAt).toISOString(),
        state: 'scheduled',
        createdBy: userId,
        createdAt: ts,
        updatedAt: ts,
      })
      .run();
    this.log.info(
      {
        recordingId: id,
        channelId: channel.id,
        title,
        startAt: new Date(startAt).toISOString(),
        endAt,
      },
      'recording scheduled',
    );
    if (startAt <= nowMs) await this.tick();
    return this.get(id)!;
  }

  /** Stops a running recording (done) or cancels a scheduled one (removed). */
  async stopRecording(id: string): Promise<Recording> {
    const row = this.db.select().from(schema.recordings).where(eq(schema.recordings.id, id)).get();
    if (!row) throw new RecordingError(404, 'No such recording');
    if (row.state === 'scheduled') {
      this.db.delete(schema.recordings).where(eq(schema.recordings.id, id)).run();
      return toRecording({ ...row, state: 'failed', error: 'cancelled' });
    }
    if (row.state !== 'recording')
      throw new RecordingError(409, `Recording is already ${row.state}`);
    await this.finish(id, null);
    return this.get(id)!;
  }

  /** Deletes a recording and its files; a running one is stopped first. */
  async remove(id: string): Promise<void> {
    const row = this.db.select().from(schema.recordings).where(eq(schema.recordings.id, id)).get();
    if (!row) throw new RecordingError(404, 'No such recording');
    if (row.state === 'recording') await this.finish(id, null);
    this.db.delete(schema.recordings).where(eq(schema.recordings.id, id)).run();
    if (row.filePath) {
      await rm(row.filePath, { force: true });
      await rm(sidecarPath(row.filePath), { force: true });
    }
  }

  /** Starts due scheduled recordings and stops those past their end. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const nowIso = now();
      const due = this.db
        .select()
        .from(schema.recordings)
        .where(
          and(
            eq(schema.recordings.state, 'scheduled'),
            inArray(schema.recordings.state, ['scheduled']),
          ),
        )
        .orderBy(asc(schema.recordings.startAt))
        .all()
        .filter((r) => r.startAt <= nowIso);
      for (const r of due) await this.begin(r.id);
      for (const [id, a] of this.active) {
        const row = this.db
          .select({ endAt: schema.recordings.endAt })
          .from(schema.recordings)
          .where(eq(schema.recordings.id, id))
          .get();
        if (row?.endAt && row.endAt <= nowIso && !a.stopping) await this.finish(id, null);
      }
    } finally {
      this.ticking = false;
    }
  }

  private async begin(id: string): Promise<void> {
    const row = this.db.select().from(schema.recordings).where(eq(schema.recordings.id, id)).get();
    if (!row || row.state !== 'scheduled') return;
    // Already past its end (server was down): fail it rather than record nothing.
    if (row.endAt && row.endAt <= now()) {
      this.db
        .update(schema.recordings)
        .set({
          state: 'failed',
          error: 'Missed: the server was not running at the time',
          updatedAt: now(),
        })
        .where(eq(schema.recordings.id, id))
        .run();
      return;
    }
    const dir = path.join(this.config.recordingsDir, safeName(row.channelName));
    await mkdir(dir, { recursive: true });
    const filePath = uniquePath(
      path.join(dir, `${safeName(row.title)} (${formatStamp(new Date())}).ts`),
    );
    let subscription: Subscription;
    try {
      subscription = this.relays.subscribe(row.channelId);
      await subscription.ready;
    } catch (error) {
      const message = error instanceof LiveStreamError ? error.message : String(error);
      this.db
        .update(schema.recordings)
        .set({
          state: 'failed',
          error: message,
          actualStartAt: now(),
          actualEndAt: now(),
          updatedAt: now(),
        })
        .where(eq(schema.recordings.id, id))
        .run();
      this.log.warn({ recordingId: id, error: message }, 'recording could not start');
      return;
    }
    const file = createWriteStream(filePath);
    const active: Active = { subscription, file, bytes: 0, stopping: false };
    this.active.set(id, active);
    this.db
      .update(schema.recordings)
      .set({ state: 'recording', filePath, actualStartAt: now(), updatedAt: now() })
      .where(eq(schema.recordings.id, id))
      .run();
    await writeFile(
      sidecarPath(filePath),
      JSON.stringify(
        {
          ...toRecording({ ...row, state: 'recording', filePath, actualStartAt: now() }),
          filePath,
        },
        null,
        2,
      ),
    );
    this.log.info({ recordingId: id, filePath }, 'recording started');
    const onData = (chunk: Buffer) => {
      if (active.stopping) return;
      active.bytes += chunk.length;
      file.write(chunk);
    };
    active.onData = onData;
    subscription.stream.on('data', onData);
    // The provider connection ended (dropped, or the relay was evicted): finish with what we have.
    subscription.stream.on('end', () => {
      if (!active.stopping) void this.finish(id, 'The stream ended before the planned end');
    });
    file.on('error', (error) => void this.finish(id, `Could not write the file: ${error.message}`));
  }

  private async finish(id: string, error: string | null): Promise<void> {
    const active = this.active.get(id);
    if (!active || active.stopping) return;
    active.stopping = true;
    this.active.delete(id);
    // Stop feeding the file before ending it: bytes still buffered in the relay stream would
    // otherwise be written after end(), which errors the stream and never fires 'finish'.
    if (active.onData) active.subscription.stream.off('data', active.onData);
    active.subscription.close();
    await closeFile(active.file);
    const filePath = this.filePath(id);
    const size = filePath
      ? await stat(filePath)
          .then((s) => s.size)
          .catch(() => active.bytes)
      : active.bytes;
    const durationMs = filePath ? await this.probeDuration(filePath) : null;
    const failed = error !== null && size === 0;
    this.db
      .update(schema.recordings)
      .set({
        state: failed ? 'failed' : 'done',
        error,
        actualEndAt: now(),
        sizeBytes: size,
        durationMs,
        updatedAt: now(),
      })
      .where(eq(schema.recordings.id, id))
      .run();
    if (filePath) {
      const rec = this.get(id);
      await writeFile(sidecarPath(filePath), JSON.stringify({ ...rec, filePath }, null, 2)).catch(
        () => undefined,
      );
    }
    this.log.info({ recordingId: id, sizeBytes: size, durationMs, error }, 'recording finished');
  }

  private async probeDuration(filePath: string): Promise<number | null> {
    try {
      const { stdout } = await execa(
        this.config.ffprobePath,
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath],
        { timeout: 20_000 },
      );
      const seconds = Number(stdout.trim());
      return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null;
    } catch {
      return null;
    }
  }

  /** Bytes written so far for a running recording (tests and the status endpoint). */
  bytesOf(id: string): number {
    return this.active.get(id)?.bytes ?? 0;
  }

  async close(): Promise<void> {
    this.stop();
    // Shutdown: whatever is running stays 'recording' and is failed on restart, but flush files.
    for (const [id, a] of this.active) {
      a.stopping = true;
      if (a.onData) a.subscription.stream.off('data', a.onData);
      a.subscription.close();
      await closeFile(a.file);
      const size = a.bytes;
      this.db
        .update(schema.recordings)
        .set({ sizeBytes: size, updatedAt: now() })
        .where(eq(schema.recordings.id, id))
        .run();
    }
    this.active.clear();
  }
}

const toRecording = (r: typeof schema.recordings.$inferSelect): Recording => ({
  id: r.id,
  channelId: r.channelId,
  channelName: r.channelName,
  channelLogoUrl: r.channelLogoUrl,
  title: r.title,
  description: r.description,
  programmeId: r.programmeId,
  startAt: r.startAt,
  endAt: r.endAt,
  actualStartAt: r.actualStartAt,
  actualEndAt: r.actualEndAt,
  state: r.state,
  sizeBytes: r.sizeBytes,
  durationMs: r.durationMs,
  error: r.error,
  createdAt: r.createdAt,
});

/** Ends the file and waits for it to close, whether it finished cleanly or failed; never hangs. */
function closeFile(file: WriteStream): Promise<void> {
  return new Promise<void>((resolve) => {
    if (file.closed || file.destroyed) return resolve();
    const timer = setTimeout(() => {
      file.destroy();
      resolve();
    }, 10_000);
    file.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
    file.end();
  });
}

export function safeName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'Recording'
  );
}

/** "2026-09-05 18-30" in local time, for file names. */
export function formatStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}`;
}

export function sidecarPath(filePath: string): string {
  return filePath.replace(/\.ts$/, '') + '.json';
}

function uniquePath(filePath: string): string {
  if (!existsSync(filePath)) return filePath;
  const base = filePath.replace(/\.ts$/, '');
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i}).ts`;
    if (!existsSync(candidate)) return candidate;
  }
}

function statSizeSync(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}
