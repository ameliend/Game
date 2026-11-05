import { expect, test } from '@playwright/test';
test('les commerces ont leurs enseignes, leurs pièces et la mairie son bulletin', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/e2e/commerce.html');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForFunction(() => Boolean((window as any).scene.current?.sys?.isActive()));
  const names = await page.evaluate(() =>
    (window as any).scene.current.objects.list.map((o: any) => o.name),
  );
  for (const kind of [
    'bakery',
    'supermarket',
    'butcher',
    'pharmacy',
    'barber',
    'nail_salon',
    'restaurant',
  ]) {
    expect(names).toContain('shop-label:' + kind);
    expect(names).toContain('income:' + kind);
  }
  expect(names).toContain('ballot:townhall');
  for (const name of ['income:bakery', 'ballot:townhall']) {
    await page.evaluate((name) => {
      const s = (window as any).scene.current,
        o = s.objects.getByName(name);
      s.cameras.main.centerOn(o.x, o.y);
    }, name);
    // Wait for Phaser's camera pre-render to apply the transform before projecting.
    await page.waitForFunction((name) => {
      const s = (window as any).scene.current,
        o = s.objects.getByName(name),
        p = s.cameras.main.getWorldPoint(s.scale.width / 2, s.scale.height / 2);
      return Math.abs(p.x - o.x) < 1 && Math.abs(p.y - o.y) < 1;
    }, name);
    const p = await page.evaluate((name) => {
      const s = (window as any).scene.current,
        c = s.cameras.main,
        o = s.objects.getByName(name);
      const p = c.matrix.transformPoint(o.x - c.scrollX, o.y - c.scrollY);
      return { x: p.x, y: p.y };
    }, name);
    if (info.project.name === 'mobile') await page.touchscreen.tap(p.x, p.y);
    else await page.mouse.click(p.x, p.y);
    await expect(page.getByTestId('commerce-selection')).toHaveText(
      name === 'income:bakery' ? 'income:bakery' : 'civic:townhall',
    );
  }
  await page.evaluate(() => {
    const s = (window as any).scene.current;
    s.center();
    s.cameras.main.setZoom(s.scale.width > 700 ? 1.1 : 0.5);
  });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.screenshot({ path: info.outputPath('commerces.png'), fullPage: true });
  expect(errors).toEqual([]);
});
