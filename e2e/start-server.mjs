// Starts the API serving web/dist against a throwaway data directory for the e2e suite.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'projektor-e2e-'));
// A fake IPTV provider on 8098 looping the sample movie as a live channel.
const provider = spawn('npx', ['tsx', 'src/live/fake-xtream-server.ts'], {
  cwd: path.join(root, 'server'),
  stdio: 'inherit',
  env: {
    ...process.env,
    FAKE_XTREAM_PORT: '8098',
    FAKE_XTREAM_FILE: path.join(root, 'fixtures/movies/Sample Movie (2019)/Sample Movie (2019).mp4'),
  },
});
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
    // Sixteen UI sign-ins plus API logins in under a minute would trip the default 20/min.
    AUTH_RATE_LIMIT: '1000',
  },
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    provider.kill(signal);
    child.kill(signal);
  });
child.on('exit', (code) => {
  provider.kill('SIGTERM');
  process.exit(code ?? 0);
});
