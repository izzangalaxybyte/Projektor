import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configForDataDir, type Config } from './config.js';

/** A Config rooted in a fresh temp directory, plus a cleanup that deletes it. */
export function makeTestConfig(): { config: Config; cleanup: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'projektor-test-'));
  return {
    config: configForDataDir(dir, { logLevel: 'fatal' }),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
