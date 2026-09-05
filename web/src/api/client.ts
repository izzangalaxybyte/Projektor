import { createProjektorClient, type components } from '@projektor/api-contract';
import { authStore } from '../auth/store.js';

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

/** One client for the whole app. Same-origin in production; Vite proxies /api in development. */
export const api = createProjektorClient({ baseUrl: '', getToken: () => authStore.token });

/** Turns an openapi-fetch result into data or a thrown Error with the server's message. */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.error !== undefined || !result.data) {
    const message =
      (result.error as { message?: string } | undefined)?.message ??
      `Request failed (${result.response.status})`;
    const error = new Error(message) as Error & { status: number };
    error.status = result.response.status;
    throw error;
  }
  return result.data;
}

/** URL for cached artwork at a given width. */
export function imageUrl(key: string | null | undefined, width: 300 | 780 | 1280): string | null {
  return key ? `/api/images/${key}?w=${width}` : null;
}

/** Appends the token for URLs the browser fetches itself (video src, VTT tracks). */
export function withAccessToken(url: string): string {
  const token = authStore.token;
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;
}
