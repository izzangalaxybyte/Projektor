// Pulls categories, channels, and the guide from the provider into SQLite on a schedule.
import { randomUUID } from 'node:crypto';
import { eq, inArray, lt, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { now, schema, type Db } from '../db/index.js';
import type { SettingsService } from '../settings/service.js';
import { XtreamClient, XtreamError, type Fetcher, type XtreamCredentials } from './xtream.js';

export const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface LiveState {
  refreshing: boolean;
  lastRefreshAt: string | null;
  lastError: string | null;
  accountStatus: string | null;
  accountExpiresAt: string | null;
}

export class LiveRefresher {
  readonly state: LiveState = {
    refreshing: false,
    lastRefreshAt: null,
    lastError: null,
    accountStatus: null,
    accountExpiresAt: null,
  };
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly log: FastifyBaseLogger,
    private readonly defaultUrl: string,
    private readonly fetcher?: Fetcher,
  ) {}

  /** The URL in use: the admin setting, else IPTV_URL / the built-in default. */
  url(): string {
    return this.settings.get('iptv.url') ?? this.defaultUrl;
  }

  credentials(): XtreamCredentials | null {
    const username = this.settings.get('iptv.username');
    const password = this.settings.get('iptv.password');
    if (!username || !password) return null;
    return { url: this.url(), username, password };
  }

  client(): XtreamClient | null {
    const creds = this.credentials();
    return creds ? new XtreamClient(creds, this.fetcher) : null;
  }

  /** Starts the periodic refresh; runs once right away when credentials exist. */
  start(): void {
    this.stop();
    this.timer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS);
    this.timer.unref();
    if (this.credentials()) void this.refresh();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Refreshes now (coalescing concurrent calls). Resolves when done; errors land in state.lastError. */
  refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run().finally(() => (this.inFlight = null));
    return this.inFlight;
  }

  private async run(): Promise<void> {
    const client = this.client();
    if (!client) {
      this.state.lastError = 'IPTV credentials are not set';
      return;
    }
    this.state.refreshing = true;
    try {
      const account = await client.account();
      this.state.accountStatus = account.status ?? null;
      this.state.accountExpiresAt =
        account.exp_date && /^\d+$/.test(account.exp_date)
          ? new Date(Number(account.exp_date) * 1000).toISOString()
          : null;

      const [categories, streams] = await Promise.all([
        client.liveCategories(),
        client.liveStreams(),
      ]);
      const ts = now();
      this.db.transaction((tx) => {
        tx.delete(schema.liveCategories).where(eq(schema.liveCategories.kind, 'live')).run();
        if (categories.length) {
          tx.insert(schema.liveCategories)
            .values(
              categories.map((c, i) => ({
                id: c.category_id,
                name: c.category_name,
                kind: 'live' as const,
                sortOrder: i,
              })),
            )
            .onConflictDoUpdate({
              target: schema.liveCategories.id,
              set: { name: sql`excluded.name`, sortOrder: sql`excluded.sort_order` },
            })
            .run();
        }
        const seen = new Set<string>();
        for (const s of streams) {
          const id = String(s.stream_id);
          seen.add(id);
          tx.insert(schema.liveChannels)
            .values({
              id,
              name: s.name,
              number: s.num ?? null,
              logoUrl: s.stream_icon || null,
              categoryId: s.category_id || null,
              epgChannelId: s.epg_channel_id || null,
              hasArchive: (s.tv_archive ?? 0) === 1,
              archiveDays: s.tv_archive_duration ?? 0,
              updatedAt: ts,
            })
            .onConflictDoUpdate({
              target: schema.liveChannels.id,
              set: {
                name: sql`excluded.name`,
                number: sql`excluded.number`,
                logoUrl: sql`excluded.logo_url`,
                categoryId: sql`excluded.category_id`,
                epgChannelId: sql`excluded.epg_channel_id`,
                hasArchive: sql`excluded.has_archive`,
                archiveDays: sql`excluded.archive_days`,
                updatedAt: ts,
              },
            })
            .run();
        }
        // Channels the provider dropped go away too.
        const stale = tx
          .select({ id: schema.liveChannels.id })
          .from(schema.liveChannels)
          .all()
          .map((r) => r.id)
          .filter((id) => !seen.has(id));
        if (stale.length)
          tx.delete(schema.liveChannels).where(inArray(schema.liveChannels.id, stale)).run();
      });

      const programmes = await client.guide();
      const wanted = new Set(
        this.db
          .select({ epg: schema.liveChannels.epgChannelId })
          .from(schema.liveChannels)
          .all()
          .map((r) => r.epg)
          .filter((v): v is string => !!v),
      );
      const keep = programmes.filter((p) => wanted.has(p.epgChannelId));
      this.db.transaction((tx) => {
        tx.delete(schema.liveProgrammes).run();
        for (let i = 0; i < keep.length; i += 500) {
          tx.insert(schema.liveProgrammes)
            .values(
              keep.slice(i, i + 500).map((p) => ({
                id: randomUUID(),
                epgChannelId: p.epgChannelId,
                title: p.title,
                description: p.description,
                startAt: p.startAt,
                endAt: p.endAt,
              })),
            )
            .run();
        }
      });
      this.state.lastRefreshAt = now();
      this.state.lastError = null;
      this.log.info(
        { categories: categories.length, channels: streams.length, programmes: keep.length },
        'live guide refreshed',
      );
    } catch (error) {
      this.state.lastError = error instanceof XtreamError ? error.message : String(error);
      this.log.warn({ error: this.state.lastError }, 'live refresh failed');
    } finally {
      this.state.refreshing = false;
    }
  }

  /** Drops programmes that ended more than the given number of days ago. */
  pruneProgrammes(olderThanDays = 8): void {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
    this.db.delete(schema.liveProgrammes).where(lt(schema.liveProgrammes.endAt, cutoff)).run();
  }
}
