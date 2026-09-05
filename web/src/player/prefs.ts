// Player preferences that persist across sessions: how far a skip jumps and the playback speed.
// The skip amount is the point of this app: forward should move exactly what you asked, not 10s.

export const SKIP_OPTIONS = [3, 4, 5, 6, 7, 8, 9, 10, 15] as const;
export const RATE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export type SkipSeconds = (typeof SKIP_OPTIONS)[number];
export type PlaybackRate = (typeof RATE_OPTIONS)[number];

export interface PlayerPrefs {
  skipSeconds: SkipSeconds;
  rate: PlaybackRate;
}

export const DEFAULT_PREFS: PlayerPrefs = { skipSeconds: 10, rate: 1 };
const KEY = 'projektor.player';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

export function loadPrefs(storage: Storage | null = safeStorage()): PlayerPrefs {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<PlayerPrefs>;
    return {
      skipSeconds: (SKIP_OPTIONS as readonly number[]).includes(parsed.skipSeconds ?? -1)
        ? parsed.skipSeconds!
        : DEFAULT_PREFS.skipSeconds,
      rate: (RATE_OPTIONS as readonly number[]).includes(parsed.rate ?? -1)
        ? parsed.rate!
        : DEFAULT_PREFS.rate,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: PlayerPrefs, storage: Storage | null = safeStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* private mode or quota: keep going with in-memory prefs */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export const formatRate = (rate: number): string => (rate === 1 ? 'Normal' : `${rate}×`);
