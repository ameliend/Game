import { test, expect } from '@playwright/test';
test('un panneau bloque le clic et le déplacement sous son bouton, puis rend la carte accessible', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/e2e/map.html');
  await page.waitForFunction(() => Boolean((window as any).scene.current?.sys?.isActive()));
  await page.getByRole('button', { name: 'Ouvrir panneau arbre' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).scene.current.input.enabled))
    .toBe(false);
  const previous = await page.getByTestId('selection').textContent();
  const pos = await page.getByTestId('position').textContent();
  const button = await page.getByRole('button', { name: 'Couper et fermer' }).boundingBox();
  if (!button) throw new Error('Bouton absent');
  const point = { x: button.x + button.width / 2, y: button.y + button.height / 2 };
  await page.evaluate(({ x, y }) => {
    const s = (window as any).scene.current,
      c = s.cameras.main;
    s.world = {
      ...s.world,
      buildings: [{ id: 'under-panel', kind: 'fence', size: 1, x: 30, y: 30 }],
    };
    s.redraw();
    c.centerOn(0, 720);
    c.scrollX += (c.width / 2 - x) / c.zoom;
    c.scrollY += (c.height / 2 - y) / c.zoom;
  }, point);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.getByRole('button', { name: 'Couper et fermer' }).click();
  await expect(page.getByTestId('selection')).toHaveText(previous ?? '');
  await expect(page.getByTestId('position')).toHaveText(pos ?? '');
  await expect
    .poll(() => page.evaluate(() => (window as any).scene.current.input.enabled))
    .toBe(true);
  // The fence physically under the CTA only activates on a new map click.
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId('selection')).toHaveText('building:under-panel');
  expect(errors).toEqual([]);
});
