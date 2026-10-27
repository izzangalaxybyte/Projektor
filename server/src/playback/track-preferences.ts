// Per-user audio and subtitle picks for a show, carried from one episode to the next.
import { and, eq } from 'drizzle-orm';
import { now, schema, type Db } from '../db/index.js';

export interface TrackLabel {
  language: string | null;
  title: string | null;
}

/** What the user last picked for a show; undefined parts were never picked. */
export interface TrackPreference {
  audio?: TrackLabel;
  /** null: subtitles off. */
  subtitle?: TrackLabel | null;
}

const same = (a: string | null, b: string | null) =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
const isSigns = (t: TrackLabel) => /sign|song|forced/i.test(t.title ?? '');

/**
 * The track in another episode's file that stands for [want]: the same language and title,
 * else the same title, else the same language (keeping to a signs-only track or away from one,
 * as the pick was).
 */
export function matchTrack<T extends TrackLabel>(tracks: readonly T[], want: TrackLabel): T | null {
  const exact = tracks.find((t) => same(t.language, want.language) && same(t.title, want.title));
  if (exact) return exact;
  if (want.title) {
    const titled = tracks.find((t) => same(t.title, want.title));
    if (titled) return titled;
  }
  if (!want.language) return null;
  const sameLanguage = tracks.filter((t) => same(t.language, want.language));
  return sameLanguage.find((t) => isSigns(t) === isSigns(want)) ?? sameLanguage[0] ?? null;
}

export class TrackPreferences {
  constructor(private readonly db: Db) {}

  /** The show a file's episode belongs to; null for movies and unmatched files. */
  showOfFile(fileId: string): string | null {
    const row = this.db
      .select({ showId: schema.episodes.showId })
      .from(schema.mediaFiles)
      .innerJoin(schema.episodes, eq(schema.episodes.id, schema.mediaFiles.episodeId))
      .where(eq(schema.mediaFiles.id, fileId))
      .get();
    return row?.showId ?? null;
  }

  get(userId: string, showId: string): TrackPreference {
    const row = this.db
      .select()
      .from(schema.trackPreferences)
      .where(
        and(eq(schema.trackPreferences.userId, userId), eq(schema.trackPreferences.showId, showId)),
      )
      .get();
    if (!row) return {};
    const pref: TrackPreference = {};
    if (row.audioSet) pref.audio = { language: row.audioLanguage, title: row.audioTitle };
    if (row.subtitleSet)
      pref.subtitle = row.subtitleOff
        ? null
        : { language: row.subtitleLanguage, title: row.subtitleTitle };
    return pref;
  }

  /** Records a pick; parts left undefined keep their earlier value. */
  save(userId: string, showId: string, pick: TrackPreference): void {
    const values: Partial<typeof schema.trackPreferences.$inferInsert> = {};
    if (pick.audio !== undefined)
      Object.assign(values, {
        audioSet: true,
        audioLanguage: pick.audio.language,
        audioTitle: pick.audio.title,
      });
    if (pick.subtitle !== undefined)
      Object.assign(values, {
        subtitleSet: true,
        subtitleOff: pick.subtitle === null,
        subtitleLanguage: pick.subtitle?.language ?? null,
        subtitleTitle: pick.subtitle?.title ?? null,
      });
    if (Object.keys(values).length === 0) return;
    const updatedAt = now();
    this.db
      .insert(schema.trackPreferences)
      .values({ userId, showId, ...values, updatedAt })
      .onConflictDoUpdate({
        target: [schema.trackPreferences.userId, schema.trackPreferences.showId],
        set: { ...values, updatedAt },
      })
      .run();
  }
}
