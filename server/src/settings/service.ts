import { eq } from 'drizzle-orm';
import { now, schema, type Db } from '../db/index.js';

/** Known setting keys. Values are stored as strings in the settings table. */
export const SETTING_KEYS = [
  'tmdb.apiKey',
  'opensubtitles.apiKey',
  'opensubtitles.username',
  'opensubtitles.password',
  'iptv.url',
  'iptv.username',
  'iptv.password',
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export class SettingsService {
  constructor(private readonly db: Db) {}

  get(key: SettingKey): string | null {
    return (
      this.db
        .select({ value: schema.settings.value })
        .from(schema.settings)
        .where(eq(schema.settings.key, key))
        .get()?.value ?? null
    );
  }

  set(key: SettingKey, value: string | null): void {
    if (value === null || value === '') {
      this.db.delete(schema.settings).where(eq(schema.settings.key, key)).run();
      return;
    }
    this.db
      .insert(schema.settings)
      .values({ key, value, updatedAt: now() })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: now() } })
      .run();
  }

  /** Secrets are never returned in full; the API shows whether they are set and their last 4 chars. */
  masked(key: SettingKey): { set: boolean; hint: string | null } {
    const value = this.get(key);
    if (!value) return { set: false, hint: null };
    return { set: true, hint: value.length > 4 ? `…${value.slice(-4)}` : '…' };
  }
}
