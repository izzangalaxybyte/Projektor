import { expect, test, type Page } from '@playwright/test';
import { ensureAdmin, signIn } from './helpers.js';

test.describe.configure({ mode: 'serial' });

const PROVIDER = 'http://127.0.0.1:8098';
let token: string;

test.beforeAll(async ({ request }) => {
  token = await ensureAdmin(request);
  await expect
    .poll(async () => (await request.get(`${PROVIDER}/player_api.php`)).status(), {
      timeout: 30_000,
    })
    .toBe(200);
});

const currentTime = (page: Page) =>
  page.getByTestId('video').evaluate((v: HTMLVideoElement) => v.currentTime);

test('settings: entering the IPTV login loads the channels', async ({ page }) => {
  await signIn(page);
  await page.goto('/settings/metadata');
  const card = page.getByTestId('iptv-card');
  await expect(card.getByTestId('iptv-status')).toHaveText('Not set up');
  await card.getByTestId('iptv-url').fill(PROVIDER);
  await card.getByTestId('iptv-url').blur();
  await card.getByTestId('iptv-username').fill('alice');
  await card.getByTestId('iptv-username').blur();
  await card.getByTestId('iptv-password').fill('secret');
  await card.getByTestId('iptv-password-save').click();
  await expect(card.getByTestId('iptv-password-status')).toHaveText('Set …cret');
  await expect(card.getByTestId('iptv-status')).toContainText('3 channels, 4 programmes', {
    timeout: 20_000,
  });
});

test('live: categories filter, now/next shows, a channel plays, keys switch channels', async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Live TV' }).click();
  await expect(page).toHaveURL(/\/live$/);
  await expect(page.getByTestId('channel-count')).toHaveText('3 channels');
  const sport = page.getByTestId('channel-1001');
  await expect(sport).toContainText('Sport One HD');
  await expect(sport).toContainText('Big Match');
  await expect(sport).toContainText('Next');
  await expect(sport).toContainText('Post-match');
  await expect(sport).toContainText('Catch-up');
  await expect(page.getByTestId('channel-1003')).toContainText('No guide information');

  await page.getByTestId('category-20').click();
  await expect(page.getByTestId('channel-count')).toHaveText('2 channels');
  await expect(sport).toHaveCount(0);
  await page.getByTestId('category-all').click();
  await expect(sport).toBeVisible();

  await sport.click();
  await expect(page).toHaveURL(/\/live\/1001\/watch$/);
  await expect(page.getByTestId('channel-name')).toContainText('Sport One HD');
  await expect(page.getByTestId('now-title')).toHaveText('Big Match');
  await expect(page.getByTestId('live-badge')).toHaveText('Live');
  await expect(page.getByTestId('seek')).toHaveCount(0);
  await expect.poll(() => currentTime(page), { timeout: 40_000 }).toBeGreaterThan(0.5);
  await expect(page.getByTestId('toggle')).toHaveAttribute('aria-label', 'Pause');

  await page.getByTestId('guide-toggle').click();
  const guide = page.getByTestId('guide-panel');
  await expect(guide).toContainText('Earlier Match');
  await expect(guide).toContainText('Big Match');
  await expect(guide).toContainText('Post-match');
  await page.keyboard.press('Escape');
  await expect(guide).toHaveCount(0);

  await page.keyboard.press('ArrowUp');
  await expect(page).toHaveURL(/\/live\/1002\/watch$/);
  await expect(page.getByTestId('channel-name')).toContainText('News 24');
  await expect(page.getByTestId('now-title')).toHaveText('Headlines');
  await expect.poll(() => currentTime(page), { timeout: 40_000 }).toBeGreaterThan(0.5);

  await page.getByTestId('channel-down').click();
  await expect(page.getByTestId('channel-name')).toContainText('Sport One HD');

  await page.keyboard.press('3');
  await expect(page.getByTestId('number-entry')).toHaveText('3');
  await expect(page).toHaveURL(/\/live\/1003\/watch$/, { timeout: 5_000 });
  await expect(page.getByTestId('channel-name')).toContainText('Silent Channel');

  await page.keyboard.press('9');
  await expect(page.getByTestId('number-entry')).toHaveText('No channel 9', { timeout: 5_000 });

  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/live$/);
});

test('catch-up: a past programme plays, and skip amount and speed apply', async ({ page }) => {
  await signIn(page);
  await page.goto('/live/1001/watch');
  await expect(page.getByTestId('channel-name')).toContainText('Sport One HD');
  await page.getByTestId('guide-toggle').click();
  const row = page.getByTestId('guide-panel').locator('.guide-row', { hasText: 'Earlier Match' });
  await row.getByTestId('catchup-play').click();
  await expect(page).toHaveURL(/\/live\/1001\/catchup\//);
  await expect(page.getByTestId('catchup-title')).toContainText('Sport One HD · Earlier Match');
  await expect(page.getByTestId('decision')).toHaveText('Catch-up');
  await expect.poll(() => currentTime(page), { timeout: 40_000 }).toBeGreaterThan(0.5);

  // The playlist grows as the provider sends the programme; wait until the player knows more
  // than the first segment, then pause so the timing assertions are exact.
  await expect
    .poll(() => page.getByTestId('video').evaluate((v: HTMLVideoElement) => v.duration), {
      timeout: 30_000,
    })
    .toBeGreaterThan(12);
  await page.getByTestId('toggle').click();
  await expect(page.getByTestId('toggle')).toHaveAttribute('aria-label', 'Play');
  await page.getByTestId('video').evaluate((v: HTMLVideoElement) => (v.currentTime = 1));
  await page.getByTestId('skip-select').selectOption('4');
  await page.getByTestId('skip-forward').click();
  await expect.poll(() => currentTime(page)).toBeCloseTo(5, 0);
  await page.getByTestId('player').click();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => currentTime(page)).toBeCloseTo(9, 0);
  await page.getByTestId('skip-back').click();
  await expect.poll(() => currentTime(page)).toBeCloseTo(5, 0);

  await page.getByTestId('speed-select').selectOption('1.5');
  await expect
    .poll(() => page.getByTestId('video').evaluate((v: HTMLVideoElement) => v.playbackRate))
    .toBe(1.5);
  await expect(page.getByTestId('seek')).toBeVisible();
});

test('IPTV movies and series: listed from the provider, a movie plays with exact skips, an episode plays', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/live');
  await page.getByTestId('live-tab-movies').click();
  await expect(page).toHaveURL(/\/live\/movies$/);
  await expect(page.getByTestId('movie-count')).toHaveText('2 movies');
  // No TMDB key in the e2e server, so titles come from the provider names, parsed.
  const tile = page.getByTestId('tile-iptv-movie').filter({ hasText: 'Sample Movie' });
  await expect(tile).toContainText('2019');
  await page.getByLabel('Search IPTV movies').fill('obscure');
  await expect(page.getByTestId('movie-count')).toHaveText('1 movies');
  await page.getByLabel('Search IPTV movies').fill('');
  await tile.click();
  await expect(page.getByTestId('iptv-title')).toHaveText('Sample Movie');
  await page.getByTestId('play').click();
  await expect(page).toHaveURL(/\/live\/movies\/5001\/watch$/);
  await expect(page.getByTestId('decision')).toHaveText('Direct play');
  await expect(page.getByTestId('catchup-title')).toHaveText('Sample Movie');
  await expect.poll(() => currentTime(page), { timeout: 30_000 }).toBeGreaterThan(0.5);
  await page.getByTestId('toggle').click();
  await expect(page.getByTestId('toggle')).toHaveAttribute('aria-label', 'Play');
  await page.getByTestId('video').evaluate((v: HTMLVideoElement) => (v.currentTime = 1));
  await page.getByTestId('skip-select').selectOption('4');
  await page.getByTestId('skip-forward').click();
  await expect.poll(() => currentTime(page)).toBeCloseTo(5, 0);
  await page.getByTestId('skip-back').click();
  await expect.poll(() => currentTime(page)).toBeCloseTo(1, 0);

  await page.goto('/live/series');
  await expect(page.getByTestId('series-count')).toHaveText('1 series');
  await page.getByTestId('tile-iptv-series').first().click();
  await expect(page.getByTestId('iptv-title')).toHaveText('Sample Show');
  await expect(page.getByTestId('episode-70011')).toContainText('Pilot');
  await page.getByTestId('season-2').click();
  await expect(page.getByTestId('episode-70021')).toContainText('Return');
  await page.getByTestId('season-1').click();
  await page.getByTestId('episode-70011').getByRole('link', { name: 'Play' }).click();
  await expect(page).toHaveURL(/\/live\/series\/7001\/episodes\/70011\/watch$/);
  await expect(page.getByTestId('catchup-title')).toHaveText('Sample Show · S1 E1 Pilot');
  await expect.poll(() => currentTime(page), { timeout: 30_000 }).toBeGreaterThan(0.5);
});
