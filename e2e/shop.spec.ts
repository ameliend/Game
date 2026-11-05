import { expect, test } from '@playwright/test';
test('un indicateur navigateur hors ligne ne bloque pas les achats quand le serveur répond', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }),
  );
  await page.goto('/e2e/shop.html');
  const buy = page.getByRole('button', { name: 'Acheter Roy Merlin pour 700 pièces' });
  await expect(buy).toBeEnabled();
  await buy.click();
  await expect(page.getByTestId('selected')).toHaveText('roy_merlin');
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(buy).toBeEnabled();
  await page.getByRole('button', { name: 'Simuler une coupure' }).click();
  await expect(buy).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('Le serveur ne répond pas');
  await page.getByRole('button', { name: 'Réessayer la connexion' }).click();
  await expect(buy).toBeEnabled();
  await page.getByRole('button', { name: 'Solde nul' }).click();
  await expect(buy).toBeDisabled();
});
