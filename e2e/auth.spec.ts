import { expect, test } from '@playwright/test';
import { ADMIN, enterPin } from './helpers.js';

test.describe.configure({ mode: 'serial' });

test('first run: setup creates the admin and lands on an empty home', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);
  await page.getByLabel('Name').fill(ADMIN.name);
  await enterPin(page, ADMIN.pin);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('home-empty')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
});

test('sign out, then sign back in with the PIN pad; a wrong PIN is refused', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByTestId(`profile-${ADMIN.name}`).click();
  await enterPin(page, '9999');
  await expect(page.getByRole('alert')).toContainText(/Invalid/);
  await page.getByLabel('Enter your PIN').fill('');
  await enterPin(page, ADMIN.pin);
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
