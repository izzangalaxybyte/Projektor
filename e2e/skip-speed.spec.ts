import { expect, test, type Page } from '@playwright/test';
import { ensureAdmin, FIXTURES, seedLibrary, signIn } from './helpers.js';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  const token = await ensureAdmin(request);
  await seedLibrary(request, token, 'Movies', 'movie', `${FIXTURES}/movies`);
});

const video = (page: Page) => page.getByTestId('video');
const currentTime = (page: Page) => video(page).evaluate((v: HTMLVideoElement) => v.currentTime);

async function openMovie(page: Page) {
  await signIn(page);
  await page.getByRole('link', { name: 'Movies', exact: true }).click();
  await expect(page).toHaveURL(/\/movies$/);
  await page.locator('.grid').getByRole('link', { name: 'Sample Movie' }).click();
  await page.getByTestId('play').click();
  await expect.poll(() => currentTime(page), { timeout: 30_000 }).toBeGreaterThan(0.2);
  // Pause so the timing assertions are exact.
  await page.getByTestId('toggle').click();
  await expect(page.getByTestId('toggle')).toHaveAttribute('aria-label', 'Play');
}

test('forward and back jump by exactly the chosen amount, on buttons and arrow keys', async ({
  page,
}) => {
  await openMovie(page);
  await video(page).evaluate((v: HTMLVideoElement) => (v.currentTime = 1));

  await expect(page.getByTestId('skip-select')).toHaveValue('10');
  await page.getByTestId('skip-select').selectOption('4');
  await expect(page.getByTestId('skip-forward')).toHaveAttribute(
    'aria-label',
    'Skip forward 4 seconds',
  );

  await page.getByTestId('skip-forward').click();
  await expect.poll(() => currentTime(page)).toBeCloseTo(5, 0);
  await page.getByTestId('skip-forward').click();
  await expect.poll(() => currentTime(page)).toBeCloseTo(9, 0);
  await page.getByTestId('skip-back').click();
  await expect.poll(() => currentTime(page)).toBeCloseTo(5, 0);

  await page.getByTestId('player').click();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => currentTime(page)).toBeCloseTo(9, 0);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => currentTime(page)).toBeCloseTo(5, 0);

  await page.getByTestId('skip-select').selectOption('15');
  await page.getByTestId('skip-forward').click();
  await expect.poll(() => currentTime(page)).toBeCloseTo(20, 0);
  await page.getByTestId('skip-back').click();
  await page.getByTestId('skip-back').click();
  // Clamped at the start.
  await expect.poll(() => currentTime(page)).toBeCloseTo(0, 0);
});

test('speed selector changes the playback rate and both choices persist across reloads', async ({
  page,
}) => {
  await openMovie(page);
  await expect(page.getByTestId('speed-select')).toHaveValue('1');
  await page.getByTestId('speed-select').selectOption('1.5');
  await expect.poll(() => video(page).evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(1.5);
  await page.getByTestId('skip-select').selectOption('7');

  await page.reload();
  await expect.poll(() => currentTime(page), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(page.getByTestId('speed-select')).toHaveValue('1.5');
  await expect(page.getByTestId('skip-select')).toHaveValue('7');
  await expect.poll(() => video(page).evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(1.5);
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('projektor.player')!))).toEqual({
    skipSeconds: 7,
    rate: 1.5,
  });
});
