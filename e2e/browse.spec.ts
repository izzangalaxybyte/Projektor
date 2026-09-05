import { expect, test } from '@playwright/test';
import { ensureAdmin, FIXTURES, seedLibrary, signIn } from './helpers.js';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  const token = await ensureAdmin(request);
  await seedLibrary(request, token, 'Movies', 'movie', `${FIXTURES}/movies`);
  await seedLibrary(request, token, 'TV', 'tv', `${FIXTURES}/tv`);
  await seedLibrary(request, token, 'Anime', 'anime', `${FIXTURES}/anime`);
});

test('home shows recently added rows per kind and reaches an episode detail', async ({ page }) => {
  await signIn(page);
  await expect(page.getByTestId('recent-movie')).toBeVisible();
  await expect(page.getByTestId('recent-tv')).toBeVisible();
  await expect(page.getByTestId('recent-anime')).toBeVisible();
  await expect(page.getByTestId('home-empty')).toHaveCount(0);

  await page.getByTestId('recent-tv').getByRole('link', { name: 'Sample Show' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sample Show');
  await page.getByTestId('children').getByTestId('tile-season').first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Season 1');
  await page.getByTestId('children').getByTestId('tile-episode').first().click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Episode 2');
  await expect(page.getByText('Sample Show', { exact: true })).toBeVisible();
  await page.getByTestId('file-info').locator('summary').click();
  await expect(page.getByTestId('file-info')).toContainText('Video: hevc');
  await expect(page.getByTestId('file-info')).toContainText('Audio: ac3');
  await expect(page.getByTestId('file-info')).toContainText('Subtitle: subrip');
  await expect(page.getByTestId('play')).toBeVisible();
});

test('library grids and anime section stay separate; search finds titles', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Movies' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Movies');
  await expect(page.getByTestId('tile-movie')).toHaveCount(2);

  await page.getByRole('link', { name: 'TV Shows' }).click();
  await expect(page.getByTestId('tile-show')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Sample Anime' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Anime' }).click();
  await expect(page.getByRole('link', { name: 'Sample Anime' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sample Show' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Search' }).click();
  await page.getByLabel('Search titles').fill('sample');
  await expect(page.getByTestId('tile-movie')).toHaveCount(1);
  await expect(page.getByTestId('tile-show')).toHaveCount(2);
});
