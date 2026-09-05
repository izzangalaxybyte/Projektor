import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { fakeXtream } from '../live/fake-xtream.js';
import { makeTestConfig, setupAdmin } from '../test-utils.js';

describe('live routes', () => {
  let cfg: ReturnType<typeof makeTestConfig>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token: string;
  const provider = fakeXtream();

  beforeEach(async () => {
    cfg = makeTestConfig();
    app = await buildApp({ config: cfg.config, fetch: provider.fetch });
    await app.ready();
    token = (await setupAdmin(app)).token;
  });
  afterEach(async () => {
    await app.close();
    cfg.cleanup();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });
  const configure = async (password = provider.password) => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: auth(),
      payload: { iptvUrl: provider.base, iptvUsername: provider.username, iptvPassword: password },
    });
    expect(res.statusCode).toBe(200);
    // The PATCH kicks off a background refresh; a second explicit call coalesces onto it and waits.
    await app.live.refresh();
  };

  it('is unconfigured and empty at first', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/live/status', headers: auth() });
    expect(res.json()).toMatchObject({
      configured: false,
      channels: 0,
      programmes: 0,
      lastRefreshAt: null,
    });
    const channels = await app.inject({
      method: 'GET',
      url: '/api/live/channels',
      headers: auth(),
    });
    expect(channels.json()).toEqual([]);
  });

  it('shows the provider fields in settings with the password masked', async () => {
    let res = await app.inject({ method: 'GET', url: '/api/settings', headers: auth() });
    expect(res.json()).toMatchObject({
      iptvUrl: 'http://playshare.co:8080/',
      iptvUsername: null,
      iptvPassword: { set: false },
    });
    await configure();
    res = await app.inject({ method: 'GET', url: '/api/settings', headers: auth() });
    expect(res.json()).toMatchObject({
      iptvUrl: provider.base,
      iptvUsername: provider.username,
      iptvPassword: { set: true },
    });
  });

  it('refreshes channels and guide after credentials are saved', async () => {
    await configure();
    const status = await app.inject({ method: 'GET', url: '/api/live/status', headers: auth() });
    expect(status.json()).toMatchObject({
      configured: true,
      refreshing: false,
      lastError: null,
      channels: 3,
      programmes: 4,
      accountStatus: 'Active',
    });
    expect(status.json().lastRefreshAt).toBeTruthy();

    const cats = await app.inject({ method: 'GET', url: '/api/live/categories', headers: auth() });
    expect(cats.json()).toEqual([
      { id: '10', name: 'Sports', kind: 'live' },
      { id: '20', name: 'News', kind: 'live' },
    ]);

    const channels = await app.inject({
      method: 'GET',
      url: '/api/live/channels',
      headers: auth(),
    });
    const list = channels.json();
    expect(list.map((c: { name: string }) => c.name)).toEqual([
      'Sport One HD',
      'News 24',
      'Silent Channel',
    ]);
    expect(list[0]).toMatchObject({
      id: '1001',
      number: 1,
      logoUrl: 'http://logo.test/1.png',
      hasArchive: true,
      archiveDays: 3,
    });
    expect(list[0].now).toMatchObject({ title: 'Big Match', description: 'Live football.' });
    expect(list[0].next).toMatchObject({ title: 'Post-match' });
    expect(list[1]).toMatchObject({
      logoUrl: null,
      hasArchive: false,
      now: { title: 'Headlines' },
      next: null,
    });
    expect(list[2]).toMatchObject({ now: null, next: null });

    const sports = await app.inject({
      method: 'GET',
      url: '/api/live/channels?category=10',
      headers: auth(),
    });
    expect(sports.json()).toHaveLength(1);

    const one = await app.inject({
      method: 'GET',
      url: '/api/live/channels/1002',
      headers: auth(),
    });
    expect(one.json()).toMatchObject({ name: 'News 24' });
    expect(
      (await app.inject({ method: 'GET', url: '/api/live/channels/9', headers: auth() }))
        .statusCode,
    ).toBe(404);
  });

  it('returns the guide window for a channel, oldest first', async () => {
    await configure();
    const guide = await app.inject({
      method: 'GET',
      url: '/api/live/guide?channel=1001',
      headers: auth(),
    });
    expect(guide.json().map((p: { title: string }) => p.title)).toEqual([
      'Earlier Match',
      'Big Match',
      'Post-match',
    ]);
    const from = new Date(Date.now() + 70 * 60_000).toISOString();
    const later = await app.inject({
      method: 'GET',
      url: `/api/live/guide?channel=1001&from=${from}`,
      headers: auth(),
    });
    expect(later.json().map((p: { title: string }) => p.title)).toEqual(['Post-match']);
    expect(
      (
        await app.inject({ method: 'GET', url: '/api/live/guide?channel=1003', headers: auth() })
      ).json(),
    ).toEqual([]);
  });

  it('records an auth failure without wiping existing data', async () => {
    await configure();
    await configure('wrong');
    const status = await app.inject({ method: 'GET', url: '/api/live/status', headers: auth() });
    expect(status.json()).toMatchObject({
      lastError: 'Provider rejected the username or password',
      channels: 3,
    });
  });

  it('drops channels the provider removed and lets an admin refresh on demand', async () => {
    await configure();
    provider.state.streams = provider.state.streams.filter((s) => s['stream_id'] !== 1003);
    const res = await app.inject({ method: 'POST', url: '/api/live/refresh', headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ channels: 2 });
    provider.state.streams.push({
      num: 3,
      name: 'Silent Channel',
      stream_id: 1003,
      stream_icon: null,
      epg_channel_id: '',
      category_id: '20',
      tv_archive: 0,
    });
  });

  it('requires a login', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/live/channels' })).statusCode).toBe(401);
  });
});
