import { expect, test, type Page } from '@playwright/test';
import { ensureAdmin, FIXTURES, seedLibrary, signIn } from './helpers.js';

test.describe.configure({ mode: 'serial' });

let token: string;
test.beforeAll(async ({ request }) => {
  token = await ensureAdmin(request);
  await seedLibrary(request, token, 'Movies', 'movie', `${FIXTURES}/movies`);
  await seedLibrary(request, token, 'TV', 'tv', `${FIXTURES}/tv`);
});

async function openEpisode(page: Page) {
  await signIn(page);
  await page.getByRole('link', { name: 'TV Shows' }).click();
  await page.getByRole('link', { name: 'Sample Show' }).click();
  await page.getByTestId('tile-season').first().click();
  await page.getByTestId('tile-episode').first().click();
}

const currentTime = (page: Page) =>
  page.getByTestId('video').evaluate((v: HTMLVideoElement) => v.currentTime);

test('plays the hevc/ac3 episode through HLS, shows subtitles, seeks, and reports progress', async ({
  page,
  request,
}) => {
  await openEpisode(page);
  const itemUrl = page.url();
  await page.getByTestId('play').click();
  await expect(page).toHaveURL(/\/play\//);
  await expect(page.getByTestId('decision')).toHaveText(/Transcoding|Remux/);

  // Playback starts and time advances.
  await expect.poll(() => currentTime(page), { timeout: 30_000 }).toBeGreaterThan(0.5);
  await expect(page.getByTestId('toggle')).toHaveAttribute('aria-label', 'Pause');

  // Subtitles: pick the embedded track and expect the first cue (1s to 4s) after seeking to 2s.
  await page.getByTestId('subtitle-select').selectOption({ index: 1 });
  await page.getByTestId('video').evaluate((v: HTMLVideoElement) => (v.currentTime = 2));
  await expect(page.getByTestId('subtitle')).toContainText('First subtitle line', {
    timeout: 10_000,
  });

  // Seek forward with the keyboard.
  await page.getByTestId('player').click();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => currentTime(page), { timeout: 15_000 }).toBeGreaterThan(11);

  // Pause forces a progress report; the API shows a position for this user.
  await page.getByTestId('toggle').click();
  await expect(page.getByTestId('toggle')).toHaveAttribute('aria-label', 'Play');
  const itemId = new URL(itemUrl).pathname.split('/').pop()!;
  await expect
    .poll(
      async () =>
        (
          await (
            await request.get(`/api/items/${itemId}`, {
              headers: { authorization: `Bearer ${token}` },
            })
          ).json()
        ).progress?.positionMs ?? 0,
      { timeout: 10_000 },
    )
    .toBeGreaterThan(10_000);

  // Back on the detail page the button offers to resume.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByTestId('play')).toHaveText(/Resume from/);
});

test('direct plays the mp4 movie', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Movies' }).click();
  await page.getByRole('link', { name: 'Sample Movie' }).click();
  await page.getByTestId('play').click();
  await expect(page.getByTestId('decision')).toHaveText('Direct play');
  await expect.poll(() => currentTime(page), { timeout: 30_000 }).toBeGreaterThan(0.5);
});
