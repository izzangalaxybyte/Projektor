import { API_BASE } from '../api/client.js';
import { authStore } from '../auth/store.js';

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
