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

test('le catalogue affiche les revenus en pièces et les exceptions des maisons et de la mairie', async ({
  page,
}) => {
  await page.goto('/e2e/shop.html');
  for (const [name, income] of [
    ['Nail saloon', 15],
    ['Roy Merlin', 50],
    ['Hôpital', 80],
    ['Grande maison', 30],
  ]) {
    const card = page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: String(name), exact: true }) });
    await expect(card).toContainText(`${income} pièces / 24 h`);
  }
  await expect(
    page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: 'Grande maison', exact: true }) }),
  ).toContainText('Aucun revenu après attribution');
  await expect(
    page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: 'Mairie', exact: true }) }),
  ).toContainText('Aucun revenu');
  await page.getByRole('button', { name: 'Acheter Clôture pour 1 pièces', exact: true }).click();
  await expect(page.getByTestId('selected')).toHaveText('fence');
});
