// Background scan jobs: one library at a time, status readable while running, coalesced
// re-requests. Walk → probe → identify → match, same order the synchronous endpoint used.
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { identifyFiles } from '../identify/identifier.js';
import { probeFiles } from '../media/probe-service.js';
import { metadataDeps } from '../metadata/deps.js';
import type { ScanStatus } from '../schemas/index.js';
import { SubtitleService } from '../subtitles/service.js';
import { scanLibrary } from './scanner.js';

type Counters = Omit<
  ScanStatus,
  'libraryId' | 'state' | 'phase' | 'startedAt' | 'finishedAt' | 'error'
>;

const zero = (): Counters => ({
  filesSeen: 0,
  filesChanged: 0,
  filesMissing: 0,
  filesProbed: 0,
  filesFailed: 0,
  itemsLinked: 0,
  itemsMatched: 0,
  itemsUnmatched: 0,
});

export class ScanRunner {
  private readonly status = new Map<string, ScanStatus>();
  private readonly queue: string[] = [];
  private readonly rerun = new Set<string>();
  private running: string | null = null;
  private idle: Promise<void> = Promise.resolve();
  private resolveIdle: (() => void) | null = null;

  constructor(
    private readonly app: FastifyInstance,
    private readonly log: FastifyBaseLogger,
  ) {}

  statusOf(libraryId: string): ScanStatus {
    return (
      this.status.get(libraryId) ?? {
        libraryId,
        state: 'idle',
        phase: null,
        ...zero(),
        startedAt: null,
        finishedAt: null,
        error: null,
      }
    );
  }

  /** Queues a scan. A library already queued is not queued twice; one already running reruns when done. */
  request(libraryId: string, reason: string): ScanStatus {
    if (this.running === libraryId) {
      this.rerun.add(libraryId);
    } else if (!this.queue.includes(libraryId)) {
      this.queue.push(libraryId);
      this.log.info({ libraryId, reason }, 'scan queued');
      if (!this.running) void this.drain();
    }
    return this.statusOf(libraryId);
  }

  /** Resolves when no scan is running or queued. Used by tests and shutdown. */
  whenIdle(): Promise<void> {
    return this.idle;
  }

  private async drain(): Promise<void> {
    this.idle = new Promise((resolve) => (this.resolveIdle = resolve));
    try {
      for (let next = this.queue.shift(); next !== undefined; next = this.queue.shift()) {
        this.running = next;
        await this.run(next);
        this.running = null;
        if (this.rerun.delete(next)) this.queue.push(next);
      }
    } finally {
      this.running = null;
      this.resolveIdle?.();
    }
  }

  private async run(libraryId: string): Promise<void> {
    const startedAt = new Date().toISOString();
    const set = (patch: Partial<ScanStatus>) =>
      this.status.set(libraryId, { ...this.statusOf(libraryId), ...patch });
    set({
      state: 'running',
      phase: 'walking',
      ...zero(),
      startedAt,
      finishedAt: null,
      error: null,
    });
    try {
      const walked = await scanLibrary(this.app.db, libraryId, this.log);
      set({
        phase: 'probing',
        filesSeen: walked.filesSeen,
        filesChanged: walked.filesChanged,
        filesMissing: walked.filesMissing,
      });
      const probed = await probeFiles(this.app.db, walked.changedFileIds, {
        ffprobePath: this.app.config.ffprobePath,
        log: this.log,
      });
      await new SubtitleService(this.app.db, this.app.config, this.log).discover(
        walked.changedFileIds,
      );
      set({ phase: 'identifying', filesProbed: probed.probed, filesFailed: probed.failed });
      const identified = identifyFiles(this.app.db, walked.changedFileIds, this.log);
      set({ phase: 'matching', itemsLinked: identified.movies + identified.episodes });
      const deps = metadataDeps(this.app, this.log);
      const matched = deps.matcher
        ? await deps.matcher.matchPending()
        : { matched: 0, unmatched: 0, failed: 0 };
      const anime = await deps.animeMatcher.matchPending();
      set({
        state: 'idle',
        phase: null,
        itemsMatched: matched.matched + anime.matched,
        itemsUnmatched: matched.unmatched + anime.unmatched,
        finishedAt: new Date().toISOString(),
      });
      this.log.info(this.statusOf(libraryId), 'scan finished');
    } catch (error) {
      this.log.error({ libraryId, error: String(error) }, 'scan failed');
      set({
        state: 'idle',
        phase: null,
        finishedAt: new Date().toISOString(),
        error: String(error),
      });
    }
  }
}
