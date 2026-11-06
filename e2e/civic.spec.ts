import { test, expect } from '@playwright/test';
test('les votes en cours s’ouvrent à l’arrivée et sont accessibles dans la modale', async ({
  page,
}) => {
  await page.goto('/e2e/civic.html');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Bourse de l’île : 30 pièces');
  await expect(dialog).toContainText('La couille en or');
  await dialog.getByRole('button', { name: 'Voter', exact: true }).click();
  await expect(page.getByTestId('vote-result')).toHaveText('élection:alice');
  await dialog.getByRole('button', { name: 'Oui à l’exil de 24 h' }).click();
  await expect(page.getByTestId('vote-result')).toHaveText('exil:oui');
  await dialog.getByRole('button', { name: 'Oui, démolir' }).click();
  await expect(page.getByTestId('vote-result')).toHaveText('démolition:oui');
  await dialog.getByRole('button', { name: 'Fermer', exact: true }).click();
  await page.getByRole('button', { name: 'Actualiser test' }).click();
  await expect(dialog).toHaveCount(0);
});
