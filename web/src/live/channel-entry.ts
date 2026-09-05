// Pure helpers for the live player's remote-style behaviour: channel up/down and number entry.

export interface ChannelRef {
  id: string;
  number: number | null;
}

/** The channel `step` places away in the list, wrapping at both ends. */
export function neighbourChannel<T extends ChannelRef>(
  channels: T[],
  currentId: string,
  step: 1 | -1,
): T | null {
  if (channels.length === 0) return null;
  const index = channels.findIndex((c) => c.id === currentId);
  if (index === -1) return channels[0] ?? null;
  return channels[(index + step + channels.length) % channels.length] ?? null;
}

/** The channel whose number matches the typed digits, or null. */
export function channelByNumber<T extends ChannelRef>(channels: T[], digits: string): T | null {
  if (!/^\d+$/.test(digits)) return null;
  const n = Number(digits);
  return channels.find((c) => c.number === n) ?? null;
}

/** How long after the last digit the entry commits. Short enough to feel instant, long enough for "12". */
export const NUMBER_ENTRY_COMMIT_MS = 1500;
export const NUMBER_ENTRY_MAX_DIGITS = 4;
