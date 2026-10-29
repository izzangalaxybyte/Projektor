import { API_BASE, api, type DeviceProfile, type PlaybackDecision } from '../api/client.js';
import { authStore } from '../auth/store.js';

/** The server stops sessions untouched for a minute; ping well inside that. */
const KEEPALIVE_MS = 20_000;
/** How long an unclaimed session outlives the page that opened it, for the next page to claim. */
const RELEASE_GRACE_MS = 15_000;

interface Entry {
  fileId: string;
  decision: Promise<PlaybackDecision | null>;
  state: 'pending' | 'claimed' | 'discarded';
  keepAlive?: ReturnType<typeof setInterval>;
  releaseTimer?: ReturnType<typeof setTimeout>;
}

let current: Entry | null = null;

/**
 * Opens the next episode's playback while the current one is ending, so "Next" starts at once:
 * the decision is made and the server's ffmpeg is already writing segments when the player page
 * asks for it. One at a time; a different file replaces the last.
 */
export function prewarm(fileId: string, profile: DeviceProfile): void {
  if (current?.fileId === fileId && current.state === 'pending') {
    if (current.releaseTimer) clearTimeout(current.releaseTimer);
    return;
  }
  discardPrewarmed();
  const entry: Entry = {
    fileId,
    state: 'pending',
    decision: api
      .POST('/api/playback/decide', { body: { fileId, profile, startPositionMs: 0 } })
      .then((r) => r.data ?? null)
      .catch(() => null),
  };
  current = entry;
  void entry.decision.then((d) => {
    if (!d?.sessionId) return;
    if (entry.state === 'discarded') release(d.sessionId);
    else if (entry.state === 'pending')
      entry.keepAlive = setInterval(() => void touch(entry, d.sessionId!), KEEPALIVE_MS);
  });
}

/** The prewarmed decision for this file, if there is one; the caller now owns its session. */
export async function claimPrewarmed(fileId: string): Promise<PlaybackDecision | null> {
  const entry = current;
  if (!entry || entry.fileId !== fileId || entry.state !== 'pending') return null;
  current = null;
  entry.state = 'claimed';
  stopTimers(entry);
  return entry.decision;
}

/** Stops the prewarmed session, if any. */
export function discardPrewarmed(): void {
  const entry = current;
  if (!entry) return;
  current = null;
  entry.state = 'discarded';
  stopTimers(entry);
  void entry.decision.then((d) => d?.sessionId && release(d.sessionId));
}

/** Discards the prewarmed session shortly, unless the page being opened claims it first. */
export function discardPrewarmedSoon(): void {
  const entry = current;
  if (!entry) return;
  if (entry.releaseTimer) clearTimeout(entry.releaseTimer);
  entry.releaseTimer = setTimeout(() => {
    if (current === entry) discardPrewarmed();
  }, RELEASE_GRACE_MS);
}

function stopTimers(entry: Entry): void {
  if (entry.keepAlive) clearInterval(entry.keepAlive);
  if (entry.releaseTimer) clearTimeout(entry.releaseTimer);
}

async function touch(entry: Entry, sessionId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/playback/sessions/${sessionId}/master.m3u8`, {
    headers: authHeaders(),
  }).catch(() => null);
  // Gone (a server restart): the next page decides afresh rather than claim a dead session.
  if (res?.status === 404 && current === entry) {
    current = null;
    entry.state = 'discarded';
    stopTimers(entry);
  }
}

function release(sessionId: string): void {
  void fetch(`${API_BASE}/api/playback/sessions/${sessionId}`, {
    method: 'DELETE',
    headers: authHeaders(),
  }).catch(() => undefined);
}

function authHeaders(): Record<string, string> {
  const token = authStore.token;
  return token ? { authorization: `Bearer ${token}` } : {};
}
