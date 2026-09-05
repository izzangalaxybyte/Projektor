import { createProjektorClient, type components } from '@projektor/api-contract';
import { authStore } from '../auth/store.js';
import { apiBaseUrl } from '../config.js';

export type Schemas = components['schemas'];
export type ItemSummary = Schemas['ItemSummary'];
export type ItemDetail = Schemas['ItemDetail'];
export type Profile = Schemas['Profile'];
export type Library = Schemas['Library'];
export type MediaFile = Schemas['MediaFile'];
export type SubtitleTrack = Schemas['SubtitleTrack'];
export type PlaybackDecision = Schemas['PlaybackDecision'];
export type DeviceProfile = Schemas['DeviceProfile'];
export type ScanStatus = Schemas['ScanStatus'];
export type MatchCandidate = Schemas['MatchCandidate'];
export type SettingsView = Schemas['SettingsView'];

/** One client for the whole app. Same-origin when served by the server; the baked-in address otherwise. */
export const API_BASE = apiBaseUrl();
export const api = createProjektorClient({ baseUrl: API_BASE, getToken: () => authStore.token });

/** Turns an openapi-fetch result into data or a thrown Error with the server's message. */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  // 204 responses carry no body; only a non-OK status or a returned error object is a failure.
  if (result.error !== undefined || !result.response.ok) {
    const message =
      (result.error as { message?: string } | undefined)?.message ??
      `Request failed (${result.response.status})`;
    const error = new Error(message) as Error & { status: number };
    error.status = result.response.status;
    throw error;
  }
  return result.data as T;
}

/** URL for cached artwork at a given width. */
export function imageUrl(key: string | null | undefined, width: 300 | 780 | 1280): string | null {
  return key ? `${API_BASE}/api/images/${key}?w=${width}` : null;
}

/** Appends the token for URLs the browser fetches itself (video src, VTT tracks). */
export function withAccessToken(url: string): string {
  const absolute = url.startsWith('/') ? `${API_BASE}${url}` : url;
  const token = authStore.token;
  if (!token) return absolute;
  return `${absolute}${absolute.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;
}
