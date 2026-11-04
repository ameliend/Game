import { test, expect } from '@playwright/test';
// Tests the honest unconfigured state. No fake players, auth or realtime service.
test('explique la configuration manquante sans simuler un jeu', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Préparons votre île' })).toBeVisible();
  await expect(page.getByText('Aucun service n’est simulé.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.getByRole('button', { name: 'Rejoindre le village' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
