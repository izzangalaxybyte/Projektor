import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { ScanRunner } from './scan-runner.js';

const log = { info: () => {}, warn: () => {}, error: () => {} } as unknown as FastifyBaseLogger;

/** A runner whose scans just record their order and wait to be released one at a time. */
function stubbedRunner() {
  const runner = new ScanRunner({} as FastifyInstance, log);
  const order: string[] = [];
  const pending: Array<() => void> = [];
  (runner as unknown as { run: (id: string) => Promise<void> }).run = (id) => {
    order.push(id);
    return new Promise<void>((resolve) => pending.push(resolve));
  };
  const finishCurrent = async () => {
    pending.shift()?.();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { runner, order, finishCurrent };
}

describe('ScanRunner queue', () => {
  it('runs a library changed during its own scan next, ahead of libraries already waiting', async () => {
    const { runner, order, finishCurrent } = stubbedRunner();
    runner.request('anime', 'manual');
    runner.request('tv', 'manual');
    runner.request('anime', 'watcher'); // files copied in while anime is scanning
    await finishCurrent();
    await finishCurrent();
    await finishCurrent();
    expect(order).toEqual(['anime', 'anime', 'tv']);
  });

  it('moves a watcher request ahead of queued scans', async () => {
    const { runner, order, finishCurrent } = stubbedRunner();
    runner.request('movies', 'manual');
    runner.request('tv', 'manual');
    runner.request('anime', 'interval');
    runner.request('anime', 'watcher');
    for (let i = 0; i < 3; i++) await finishCurrent();
    expect(order).toEqual(['movies', 'anime', 'tv']);
  });
});
