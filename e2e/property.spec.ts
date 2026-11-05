import { expect, test } from '@playwright/test';
test('réserve les récoltes privées au propriétaire et permet au maire de déplacer les bâtiments', async ({
  page,
}) => {
  await page.goto('/e2e/property.html');
  await expect(page.getByRole('button', { name: 'Réservé à Alice', exact: true })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Déplacer gratuitement', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Vue Alice', exact: true }).click();
  await page.getByRole('button', { name: 'Récolter', exact: true }).click();
  await expect(page.getByTestId('harvests')).toHaveText('1');
  await page.getByRole('button', { name: 'Vue Maire', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Réservé à Alice', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Déplacer gratuitement', exact: true }).click();
  await expect(page.getByTestId('moves')).toHaveText('1');
  await page.getByRole('button', { name: 'Passer en commune', exact: true }).click();
  await expect(page.getByText('Parcelle commune', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Vue Bob', exact: true }).click();
  await page.getByRole('button', { name: 'Récolter', exact: true }).click();
  await expect(page.getByTestId('harvests')).toHaveText('2');
});
