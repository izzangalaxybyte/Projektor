import { describe, expect, it } from 'vitest';
import { fakeXtream } from './fake-xtream.js';
import { LiveRefresher } from './refresher.js';
import { LiveRelayManager } from './relay.js';
import { openDatabase } from '../db/index.js';
import { SettingsService } from '../settings/service.js';
import { makeTestConfig } from '../test-utils.js';

const silent = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  trace() {},
  fatal() {},
  child() {
    return silent;
  },
} as never;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function setup(graceMs = 50, maxStreams = 2) {
  const cfg = makeTestConfig();
  const provider = fakeXtream();
  const db = openDatabase(cfg.config.dbPath).db;
  const settings = new SettingsService(db);
  settings.set('iptv.url', provider.base);
  settings.set('iptv.username', provider.username);
  settings.set('iptv.password', provider.password);
  const refresher = new LiveRefresher(db, settings, silent, cfg.config.iptvUrl, provider.fetch);
  const relays = new LiveRelayManager(refresher, silent, {
    maxStreams,
    graceMs,
    fetcher: provider.fetch,
  });
  return { provider, relays, cleanup: cfg.cleanup };
}

async function readSome(stream: NodeJS.ReadableStream, min: number): Promise<number> {
  let got = 0;
  for await (const chunk of stream) {
    got += (chunk as Buffer).length;
    if (got >= min) break;
  }
  return got;
}

describe('LiveRelayManager', () => {
  it('shares one provider connection between subscribers and closes it after the grace period', async () => {
    const { provider, relays, cleanup } = await setup();
    const a = relays.subscribe('1001');
    const b = relays.subscribe('1001');
    await a.ready;
    expect(provider.live.open).toBe(1);
    expect(relays.active()).toBe(1);
    const [ga, gb] = await Promise.all([
      readSome(a.stream, 188 * 40),
      readSome(b.stream, 188 * 40),
    ]);
    expect(ga).toBeGreaterThanOrEqual(188 * 40);
    expect(gb).toBeGreaterThanOrEqual(188 * 40);
    a.close();
    await sleep(120);
    expect(provider.live.open).toBe(1); // b still listening
    b.close();
    await sleep(200);
    expect(provider.live.open).toBe(0);
    expect(relays.active()).toBe(0);
    cleanup();
  });

  it('keeps the connection when a viewer comes back within the grace period', async () => {
    const { provider, relays, cleanup } = await setup(300);
    const a = relays.subscribe('1001');
    await a.ready;
    a.close();
    await sleep(50);
    const b = relays.subscribe('1001');
    await b.ready;
    await sleep(400);
    expect(provider.live.opened).toBe(1);
    expect(provider.live.open).toBe(1);
    b.close();
    await relays.close();
    cleanup();
  });

  it('caps concurrent provider connections', async () => {
    const { relays, cleanup } = await setup(50, 1);
    const a = relays.subscribe('1001');
    await a.ready;
    expect(() => relays.subscribe('1002')).toThrow(/connections are in use/);
    expect(() => relays.subscribe('1001')).not.toThrow(); // same channel shares
    await relays.close();
    cleanup();
  });

  it('evicts an idle relay in its grace period when the cap is reached', async () => {
    const { provider, relays, cleanup } = await setup(5000, 1);
    const a = relays.subscribe('1001');
    await a.ready;
    a.close(); // idle, but kept warm for up to 5 s
    expect(relays.active()).toBe(1);
    const b = relays.subscribe('1002');
    await b.ready;
    await sleep(50);
    expect(relays.active()).toBe(1);
    expect(provider.live.open).toBe(1);
    expect(provider.live.opened).toBe(2);
    b.close();
    await relays.close();
    cleanup();
  });

  it('rejects ready for an unknown channel and frees the slot', async () => {
    const { relays, cleanup } = await setup(50, 1);
    const a = relays.subscribe('9999');
    await expect(a.ready).rejects.toMatchObject({ statusCode: 502 });
    await sleep(20);
    expect(relays.active()).toBe(0);
    cleanup();
  });

  it('refuses without credentials', async () => {
    const cfg = makeTestConfig();
    const db = openDatabase(cfg.config.dbPath).db;
    const refresher = new LiveRefresher(db, new SettingsService(db), silent, cfg.config.iptvUrl);
    const relays = new LiveRelayManager(refresher, silent, { maxStreams: 2, graceMs: 50 });
    expect(() => relays.subscribe('1001')).toThrow(/credentials/);
    cfg.cleanup();
  });
});
