import { test, expect, type Page } from '@playwright/test';
async function coords(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ x, y }) => {
      const c = (window as any).scene.current.cameras.main;
      const p = c.matrix.transformPoint((x - y) * 24 - c.scrollX, (x + y) * 12 - c.scrollY);
      return { x: p.x, y: p.y };
    },
    { x, y },
  );
}
test('Phaser affiche la carte, sélectionne, déplace et prévisualise', async ({ page }, info) => {
  const click = (x: number, y: number) =>
    info.project.name === 'mobile' ? page.touchscreen.tap(x, y) : page.mouse.click(x, y);
  const errors: string[] = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.error(e.message);
  });
  await page.goto('/e2e/map.html');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForFunction(() => Boolean((window as any).scene.current?.sys?.isActive()));
  const tree = await coords(page, 6, 10);
  await click(tree.x, tree.y);
  await expect(page.getByTestId('selection')).toHaveText('tree:1');
  const ground = await coords(page, 16, 16);
  await click(ground.x, ground.y);
  await expect(page.getByTestId('position')).toHaveText('16,16');
  const plot = await coords(page, 12, 12);
  await click(plot.x, plot.y);
  await expect(page.getByTestId('selection')).toHaveText('plot:1');
  await page.getByRole('button', { name: 'Construction test' }).click();
  const build = await coords(page, 15, 15);
  await page.mouse.move(build.x, build.y);
  await click(build.x, build.y);
  await expect(page.getByTestId('selection')).toHaveText('place:15,15');
  await page.screenshot({ path: info.outputPath('map.png'), fullPage: true });
  expect(errors).toEqual([]);
});
