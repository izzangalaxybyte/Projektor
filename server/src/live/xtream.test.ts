import { describe, expect, it } from 'vitest';
import { fakeXtream } from './fake-xtream.js';
import { XtreamClient, parseXmltv, parseXmltvTime, type XtreamError } from './xtream.js';

describe('parseXmltvTime', () => {
  it('reads UTC and offset timestamps', () => {
    expect(parseXmltvTime('20260905183000 +0000')).toBe('2026-09-05T18:30:00.000Z');
    expect(parseXmltvTime('20260905183000 +0200')).toBe('2026-09-05T16:30:00.000Z');
    expect(parseXmltvTime('20260905183000 -0500')).toBe('2026-09-05T23:30:00.000Z');
    expect(parseXmltvTime('202609051830')).toBe('2026-09-05T18:30:00.000Z');
    expect(parseXmltvTime('garbage')).toBeNull();
  });
});

describe('parseXmltv', () => {
  it('extracts programmes and tolerates missing fields', () => {
    const out = parseXmltv(`<tv>
      <programme start="20260905180000 +0000" stop="20260905190000 +0000" channel="a"><title lang="en">One</title><desc>D</desc></programme>
      <programme start="20260905190000 +0000" stop="20260905200000 +0000" channel="a"><title>Two</title></programme>
      <programme start="bad" stop="20260905200000 +0000" channel="a"><title>Skipped</title></programme>
      <programme start="20260905190000 +0000" stop="20260905200000 +0000" channel="b"></programme>
    </tv>`);
    expect(out).toEqual([
      {
        epgChannelId: 'a',
        title: 'One',
        description: 'D',
        startAt: '2026-09-05T18:00:00.000Z',
        endAt: '2026-09-05T19:00:00.000Z',
      },
      {
        epgChannelId: 'a',
        title: 'Two',
        description: null,
        startAt: '2026-09-05T19:00:00.000Z',
        endAt: '2026-09-05T20:00:00.000Z',
      },
      {
        epgChannelId: 'b',
        title: 'Untitled',
        description: null,
        startAt: '2026-09-05T19:00:00.000Z',
        endAt: '2026-09-05T20:00:00.000Z',
      },
    ]);
  });
  it('handles a single programme (not an array)', () => {
    expect(
      parseXmltv(
        '<tv><programme start="20260905180000 +0000" stop="20260905190000 +0000" channel="a"><title>Solo</title></programme></tv>',
      ),
    ).toHaveLength(1);
  });
});

describe('XtreamClient', () => {
  const provider = fakeXtream();
  const creds = {
    url: provider.base + '/',
    username: provider.username,
    password: provider.password,
  };

  it('reports the account for good credentials and an auth error for bad ones', async () => {
    const client = new XtreamClient(creds, provider.fetch);
    const account = await client.account();
    expect(account.status).toBe('Active');
    const bad = new XtreamClient({ ...creds, password: 'nope' }, provider.fetch);
    await expect(bad.account()).rejects.toMatchObject({
      kind: 'auth',
    } satisfies Partial<XtreamError>);
  });

  it('lists categories and streams with coerced types', async () => {
    const client = new XtreamClient(creds, provider.fetch);
    const cats = await client.liveCategories();
    expect(cats.map((c) => c.category_name)).toEqual(['Sports', 'News']);
    const streams = await client.liveStreams();
    expect(streams[0]).toMatchObject({ stream_id: 1001, tv_archive: 1, tv_archive_duration: 3 });
  });

  it('parses the guide', async () => {
    const client = new XtreamClient(creds, provider.fetch);
    const guide = await client.guide();
    expect(guide.map((p) => p.title)).toContain('Big Match');
  });

  it('builds stream URLs with credentials in the path', () => {
    const client = new XtreamClient(
      { url: 'http://x.test:8080/', username: 'u s', password: 'p&w' },
      provider.fetch,
    );
    expect(client.liveUrl('1001')).toBe('http://x.test:8080/live/u%20s/p%26w/1001.ts');
    expect(client.vodUrl('7', 'mkv')).toBe('http://x.test:8080/movie/u%20s/p%26w/7.mkv');
    expect(client.timeshiftUrl('1001', new Date('2026-09-05T18:30:00Z'), 90)).toBe(
      'http://x.test:8080/timeshift/u%20s/p%26w/90/2026-09-05:18-30/1001.ts',
    );
  });

  it('surfaces network and shape errors', async () => {
    const unreachable = new XtreamClient(creds, async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(unreachable.account()).rejects.toMatchObject({ kind: 'network' });
    const weird = new XtreamClient(creds, async () => new Response('"hello"', { status: 200 }));
    await expect(weird.account()).rejects.toMatchObject({ kind: 'shape' });
    const down = new XtreamClient(creds, async () => new Response('', { status: 503 }));
    await expect(down.account()).rejects.toMatchObject({ kind: 'network' });
  });
});
