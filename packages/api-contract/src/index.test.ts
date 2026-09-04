import { describe, expect, it } from 'vitest';
import { createProjektorClient } from './index.js';

describe('createProjektorClient', () => {
  it('calls the typed health route and attaches the bearer token', async () => {
    const seen: Request[] = [];
    const fetchMock = async (req: Request) => {
      seen.push(req);
      return new Response(
        JSON.stringify({ status: 'ok', version: '0.0.0', time: new Date().toISOString() }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const client = createProjektorClient({
      baseUrl: 'http://example.test',
      getToken: () => 'abc',
      fetch: fetchMock,
    });
    const { data, error } = await client.GET('/api/health');
    expect(error).toBeUndefined();
    expect(data?.status).toBe('ok');
    expect(seen[0]?.url).toBe('http://example.test/api/health');
    expect(seen[0]?.headers.get('authorization')).toBe('Bearer abc');
  });
});
