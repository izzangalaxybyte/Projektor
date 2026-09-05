/** The owner's server has a fixed LAN address; baked in for now so no device ever needs it typed. */
export const DEFAULT_SERVER_URL = 'http://192.168.100.20:8096';

/**
 * Base URL for API calls. When the page is served by the server itself (browser use), calls stay
 * same-origin. When it is packaged into an app with no web origin of its own (the Tizen build,
 * file:// during development), calls go to the baked-in server.
 */
export function apiBaseUrl(loc: { protocol: string; hostname: string } = window.location): string {
  const standalone = loc.protocol === 'file:' || loc.hostname === '' || loc.protocol === 'app:';
  return standalone ? DEFAULT_SERVER_URL : '';
}
