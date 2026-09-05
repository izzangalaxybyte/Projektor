// Watches library folders and queues a scan when video files appear, change, or vanish.
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { FastifyBaseLogger } from 'fastify';
import { eq } from 'drizzle-orm';
import { schema, type Db } from '../db/index.js';
import type { ScanRunner } from './scan-runner.js';
import { VIDEO_EXTENSIONS } from './walker.js';

export interface WatcherOptions {
  /** Quiet period after the last event before a scan is queued. */
  debounceMs: number;
}

export class LibraryWatcher {
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly db: Db,
    private readonly runner: ScanRunner,
    private readonly log: FastifyBaseLogger,
    private readonly options: WatcherOptions,
  ) {}

  /** Starts watching every library that exists now. */
  async startAll(): Promise<void> {
    const libraries = this.db.select({ id: schema.libraries.id }).from(schema.libraries).all();
    await Promise.all(libraries.map((l) => this.watch(l.id)));
  }

  async watch(libraryId: string): Promise<void> {
    await this.unwatch(libraryId);
    const paths = this.db
      .select({ path: schema.libraryPaths.path })
      .from(schema.libraryPaths)
      .where(eq(schema.libraryPaths.libraryId, libraryId))
      .all()
      .map((p) => p.path);
    if (paths.length === 0) return;
    const watcher = chokidar.watch(paths, {
      ignoreInitial: true,
      // Downloads are written over time; wait for the size to settle before reacting.
      awaitWriteFinish: {
        stabilityThreshold: Math.min(2000, this.options.debounceMs),
        pollInterval: 100,
      },
      ignored: (p, stats) =>
        stats?.isFile()
          ? !VIDEO_EXTENSIONS.has(path.extname(p).toLowerCase())
          : path.basename(p).startsWith('.'),
    });
    const trigger = (event: string) => (file: string) => {
      this.log.debug({ libraryId, event, file }, 'library change');
      this.schedule(libraryId);
    };
    watcher
      .on('add', trigger('add'))
      .on('change', trigger('change'))
      .on('unlink', trigger('unlink'));
    watcher.on('error', (error) =>
      this.log.warn({ libraryId, error: String(error) }, 'watcher error'),
    );
    this.watchers.set(libraryId, watcher);
    // With ignoreInitial, a file that lands during the initial directory scan is silently treated
    // as pre-existing. Resolve only once that scan is done so callers can rely on later events.
    await new Promise<void>((resolve) => watcher.once('ready', () => resolve()));
    this.log.info({ libraryId, paths }, 'watching library');
  }

  async unwatch(libraryId: string): Promise<void> {
    const timer = this.timers.get(libraryId);
    if (timer) clearTimeout(timer);
    this.timers.delete(libraryId);
    const watcher = this.watchers.get(libraryId);
    if (watcher) {
      this.watchers.delete(libraryId);
      await watcher.close();
    }
  }

  async close(): Promise<void> {
    await Promise.all([...this.watchers.keys()].map((id) => this.unwatch(id)));
  }

  private schedule(libraryId: string): void {
    const existing = this.timers.get(libraryId);
    if (existing) clearTimeout(existing);
    this.timers.set(
      libraryId,
      setTimeout(() => {
        this.timers.delete(libraryId);
        this.runner.request(libraryId, 'watcher');
      }, this.options.debounceMs),
    );
  }
}
