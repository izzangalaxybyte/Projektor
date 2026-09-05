// Starts the API serving web/dist against a throwaway data directory for the e2e suite.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'projektor-e2e-'));
const child = spawn('npx', ['tsx', 'src/main.ts'], {
  cwd: path.join(root, 'server'),
  stdio: 'inherit',
  env: {
    ...process.env,
    PORT: '8099',
    HOST: '127.0.0.1',
    DATA_DIR: dataDir,
    WEB_DIST: path.join(root, 'web/dist'),
    WATCH_LIBRARIES: 'false',
    HARDWARE_ACCEL: 'none',
    LOG_LEVEL: 'warn',
    HLS_IDLE_MS: '120000',
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 0));
