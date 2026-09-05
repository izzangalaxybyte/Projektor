import { defineConfig, devices } from '@playwright/test';

// The e2e suite runs the real server (fresh temp DATA_DIR, fixtures scanned by the tests) serving
// the built web app. Run `pnpm --filter @projektor/web build` first; `pnpm e2e` does both.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8099',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    // Playwright's Chromium ships without H.264/AAC; branded Chrome plays the fixtures for real.
    channel: 'chrome',
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: {
    command: 'node e2e/start-server.mjs',
    url: 'http://127.0.0.1:8099/api/health',
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
