import { expect, test } from '@playwright/test';
test('un seul débit par ticket, grattage et résultat accessibles', async ({ page }, info) => {
  await page.goto('/e2e/luck.html');
  await page.getByRole('button', { name: 'Casino test' }).click();
  await expect(page.getByRole('dialog')).toContainText('Miser 5 pièces');
  await page.getByRole('button', { name: 'Miser 5 pièces' }).click();
  await expect(page.getByTestId('calls')).toHaveText('1');
  await expect(page.getByLabel('Zone à gratter')).toBeVisible();
  await page.screenshot({ path: info.outputPath('casino-ticket.png') });
  await page.getByRole('button', { name: 'Révéler le ticket' }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('gagné 25 pièces');
  await expect(page.getByRole('button', { name: 'Miser 5 pièces' })).toHaveCount(0);
});
test('le geste de grattage révèle aussi le ticket', async ({ page }) => {
  await page.goto('/e2e/luck.html');
  await page.getByRole('button', { name: 'Casino test' }).click();
  await page.getByRole('button', { name: 'Miser 5 pièces' }).click();
  const box = await page.getByLabel('Zone à gratter').boundingBox();
  if (!box) throw new Error('Ticket absent');
  await page.mouse.move(box.x + 10, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 60, { steps: 30 });
  await page.mouse.up();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('gagné 25 pièces');
});
test('Pol propose les deux choix, puis repart après le deal sûr', async ({ page }) => {
  await page.goto('/e2e/luck.html');
  await page.getByRole('button', { name: 'Pol test' }).click();
  await expect(page.getByRole('dialog')).toContainText('Bonjour je suis Pol');
  await expect(page.getByRole('button', { name: 'Tenter 100 sous à 50/50' })).toBeEnabled();
  await page.getByRole('button', { name: 'Prendre 50 sous sûrs' }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('gagné 50 sous');
  await expect(page.getByTestId('calls')).toHaveText('1');
  await expect(page.getByRole('button', { name: 'Prendre 50 sous sûrs' })).toHaveCount(0);
});
