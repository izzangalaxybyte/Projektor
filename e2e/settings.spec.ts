import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { ensureAdmin, FIXTURES, seedLibrary, signIn } from './helpers.js';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  const token = await ensureAdmin(request);
  await seedLibrary(request, token, 'Movies', 'movie', `${FIXTURES}/movies`);
  await seedLibrary(request, token, 'Anime', 'anime', `${FIXTURES}/anime`);
});

test('libraries: lists, adds an empty library, scans it, deletes it', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByTestId('library-Movies')).toBeVisible();
  await expect(page.getByTestId('library-Movies')).toContainText('2 files');

  const dir = mkdtempSync(path.join(os.tmpdir(), 'projektor-e2e-lib-'));
  const form = page.getByTestId('add-library');
  await form.getByLabel('Name').fill('Scratch');
  await form.getByLabel('Kind').selectOption('tv');
  await form.getByLabel('Folder on the server').fill(dir);
  await form.getByRole('button', { name: 'Add library' }).click();
  const card = page.getByTestId('library-Scratch');
  await expect(card).toBeVisible();
  await expect(card).toContainText('TV Shows');
  await card.getByTestId('scan').click();
  await expect(card).toContainText('0 files', { timeout: 15_000 });

  page.once('dialog', (d) => d.accept());
  await card.getByTestId('delete').click();
  await expect(card).toHaveCount(0);

  await form.getByLabel('Name').fill('Bad');
  await form.getByLabel('Folder on the server').fill('/definitely/not/here');
  await form.getByRole('button', { name: 'Add library' }).click();
  await expect(form.getByRole('paragraph').filter({ hasText: 'Not a directory' })).toBeVisible();
});

test('metadata: stores a TMDB key and shows it masked', async ({ page }) => {
  await signIn(page);
  await page.goto('/settings/metadata');
  await expect(page.getByTestId('tmdb-key-status')).toHaveText('Not set');
  await page.getByTestId('tmdb-key').fill('abcdefghijklmnop1234');
  await page.getByTestId('tmdb-key-save').click();
  await expect(page.getByTestId('tmdb-key-status')).toHaveText('Set …1234');
});

test('users: adds a profile that then appears on the login screen', async ({ page }) => {
  await signIn(page);
  await page.goto('/settings/users');
  const form = page.getByTestId('add-user');
  await form.getByLabel('Name').fill('Kid');
  await form.getByLabel('PIN').fill('0000');
  await form.getByRole('button', { name: 'Add profile' }).click();
  await expect(page.getByTestId('user-list')).toContainText('Kid');
  await expect(page.getByText('Your devices')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByTestId('profile-Kid')).toBeVisible();
});

test('needs review: lists the unmatched movie, surfaces the TMDB error for a bad key, saves an anime offset', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/settings/review');
  const card = page.getByTestId('review-some random download');
  await expect(card).toBeVisible();
  await card.getByTestId('search-candidates').click();
  // The key stored above is not a real TMDB key; the server's error must reach the UI.
  await expect(card.getByRole('paragraph').filter({ hasText: /TMDB/ })).toBeVisible({
    timeout: 20_000,
  });

  const offset = page.getByTestId('offset-Sample Anime');
  await offset.getByLabel('Season offset for Sample Anime').fill('12');
  await offset.getByRole('button', { name: 'Apply' }).click();
  await expect(offset.getByTestId('offset-saved')).toBeVisible();
});

test('non-admins are kept out of settings', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('profile-Kid').click();
  for (const d of '0000') await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/$/);
});
