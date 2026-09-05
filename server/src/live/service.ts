import { and, asc, eq, gt, gte, lt, lte, sql } from 'drizzle-orm';
import { schema, type Db } from '../db/index.js';
import type { LiveChannel, LiveProgramme } from '../schemas/index.js';

/** Read side for the live tables. */
export class LiveService {
  constructor(private readonly db: Db) {}

  categories(kind: 'live' | 'vod' | 'series' = 'live') {
    return this.db
      .select({
        id: schema.liveCategories.id,
        name: schema.liveCategories.name,
        kind: schema.liveCategories.kind,
      })
      .from(schema.liveCategories)
      .where(eq(schema.liveCategories.kind, kind))
      .orderBy(asc(schema.liveCategories.sortOrder))
      .all();
  }

  channels(categoryId: string | undefined, at: Date = new Date()): LiveChannel[] {
    const rows = this.db
      .select()
      .from(schema.liveChannels)
      .where(categoryId ? eq(schema.liveChannels.categoryId, categoryId) : undefined)
      .orderBy(asc(schema.liveChannels.number), asc(schema.liveChannels.name))
      .all();
    const nowNext = this.nowNext(
      rows.map((r) => r.epgChannelId).filter((v): v is string => !!v),
      at,
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      number: r.number,
      logoUrl: r.logoUrl,
      categoryId: r.categoryId,
      hasArchive: r.hasArchive,
      archiveDays: r.archiveDays,
      now: (r.epgChannelId ? nowNext.get(r.epgChannelId)?.now : null) ?? null,
      next: (r.epgChannelId ? nowNext.get(r.epgChannelId)?.next : null) ?? null,
    }));
  }

  channel(id: string, at: Date = new Date()): LiveChannel | null {
    return this.channels(undefined, at).find((c) => c.id === id) ?? null;
  }

  guide(channelId: string, from: Date, to: Date): LiveProgramme[] {
    const ch = this.db
      .select({ epg: schema.liveChannels.epgChannelId })
      .from(schema.liveChannels)
      .where(eq(schema.liveChannels.id, channelId))
      .get();
    if (!ch?.epg) return [];
    return this.db
      .select()
      .from(schema.liveProgrammes)
      .where(
        and(
          eq(schema.liveProgrammes.epgChannelId, ch.epg),
          lt(schema.liveProgrammes.startAt, to.toISOString()),
          gt(schema.liveProgrammes.endAt, from.toISOString()),
        ),
      )
      .orderBy(asc(schema.liveProgrammes.startAt))
      .all()
      .map(toProgramme);
  }

  counts(): { channels: number; programmes: number } {
    const c =
      this.db
        .select({ n: sql<number>`count(*)` })
        .from(schema.liveChannels)
        .get()?.n ?? 0;
    const p =
      this.db
        .select({ n: sql<number>`count(*)` })
        .from(schema.liveProgrammes)
        .get()?.n ?? 0;
    return { channels: Number(c), programmes: Number(p) };
  }

  /** For each guide channel id: the programme on air at `at` and the one after it. */
  private nowNext(
    epgIds: string[],
    at: Date,
  ): Map<string, { now: LiveProgramme | null; next: LiveProgramme | null }> {
    const out = new Map<string, { now: LiveProgramme | null; next: LiveProgramme | null }>();
    if (epgIds.length === 0) return out;
    const iso = at.toISOString();
    const horizon = new Date(at.getTime() + 12 * 3600_000).toISOString();
    const rows = this.db
      .select()
      .from(schema.liveProgrammes)
      .where(
        and(gte(schema.liveProgrammes.endAt, iso), lte(schema.liveProgrammes.startAt, horizon)),
      )
      .orderBy(asc(schema.liveProgrammes.epgChannelId), asc(schema.liveProgrammes.startAt))
      .all();
    const wanted = new Set(epgIds);
    for (const r of rows) {
      if (!wanted.has(r.epgChannelId)) continue;
      const entry = out.get(r.epgChannelId) ?? { now: null, next: null };
      if (r.startAt <= iso && r.endAt > iso && !entry.now) entry.now = toProgramme(r);
      else if (r.startAt > iso && !entry.next) entry.next = toProgramme(r);
      out.set(r.epgChannelId, entry);
    }
    return out;
  }
}

const toProgramme = (r: typeof schema.liveProgrammes.$inferSelect): LiveProgramme => ({
  id: r.id,
  title: r.title,
  description: r.description,
  startAt: r.startAt,
  endAt: r.endAt,
});
