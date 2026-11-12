import { API_BASE } from '../api/client.js';
import { authStore } from '../auth/store.js';

/** The server stops sessions untouched for a minute; ping well inside that. */
const KEEPALIVE_MS = 20_000;

/**
 * Keeps a server session open while its page is: a paused player with a full buffer requests
 * nothing, and the server would otherwise stop the session as idle and resuming would fail.
 */
export function keepSessionAlive(sessionId: string): () => void {
  const timer = setInterval(() => {
    const token = authStore.token;
    void fetch(`${API_BASE}/api/playback/sessions/${sessionId}/master.m3u8`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }).catch(() => undefined);
  }, KEEPALIVE_MS);
  return () => clearInterval(timer);
}

/**
 * Frees a server session when the tab is closed, refreshed, or navigated away, cases React's
 * effect cleanup does not reliably reach. keepalive lets the request outlive the page.
 */
export function releaseSessionOnPageHide(path: string): () => void {
  const release = () => {
    const token = authStore.token;
    void fetch(`${API_BASE}${path}`, {
      method: 'DELETE',
      keepalive: true,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }).catch(() => undefined);
  };
  window.addEventListener('pagehide', release);
  return () => window.removeEventListener('pagehide', release);
}
