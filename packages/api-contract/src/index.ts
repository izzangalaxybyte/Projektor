import createOpenApiClient, { type ClientOptions } from 'openapi-fetch';
import type { paths } from './schema.js';

export type { paths, components } from './schema.js';

export interface ProjektorClientOptions extends Omit<ClientOptions, 'baseUrl' | 'headers'> {
  /** Server origin, e.g. http://192.168.1.10:8096 */
  baseUrl: string;
  /** Bearer token returned by login. Read on every request so it can change over time. */
  getToken?: () => string | null | undefined;
}

export function createProjektorClient(options: ProjektorClientOptions) {
  const { baseUrl, getToken, ...rest } = options;
  const client = createOpenApiClient<paths>({ baseUrl, ...rest });
  client.use({
    onRequest({ request }) {
      const token = getToken?.();
      if (token) request.headers.set('authorization', `Bearer ${token}`);
      return request;
    },
  });
  return client;
}

export type ProjektorClient = ReturnType<typeof createProjektorClient>;
