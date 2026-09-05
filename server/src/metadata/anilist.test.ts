import { describe, expect, it } from 'vitest';

describe('AniListClient pacing', () => {
  it('spaces requests out and waits out a 429 using Retry-After', async () => {
    const waits: number[] = [];
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      if (calls === 2) return new Response('', { status: 429, headers: { 'retry-after': '3' } });
      return new Response(JSON.stringify({ data: { Page: { media: [] } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const { AniListClient } = await import('./anilist.js');
    const client = new AniListClient(fetcher, {
      minIntervalMs: 500,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    await client.search('one');
    await client.search('two'); // 429 once, then succeeds
    expect(calls).toBe(3);
    expect(waits).toContain(3_000);
    expect(waits.some((w) => w > 0 && w <= 500)).toBe(true);
  });

  it('gives up after the retry budget', async () => {
    const fetcher = async () => new Response('', { status: 429 });
    const { AniListClient } = await import('./anilist.js');
    const client = new AniListClient(fetcher, {
      minIntervalMs: 0,
      maxRetries: 1,
      sleep: async () => {},
    });
    await expect(client.search('x')).rejects.toMatchObject({ status: 429 });
  });
});
