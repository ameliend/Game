import { expect, test } from '@playwright/test';
test('la mairie officielle et les nouveaux bâtiments sont dessinés et sélectionnables', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/e2e/catalogue.html');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForFunction(() => Boolean((window as any).scene.current?.sys?.isActive()));
  const labels = await page.evaluate(() =>
    (window as any).scene.current.objects.list
      .filter((o: any) => o.type === 'Text')
      .map((o: any) => o.text),
  );
  for (const label of [
    'Roy Merlin',
    'Chocolaterie',
    'Ferme',
    'Hôtel',
    'Mairie',
    'MAIRIE',
    'Coffeeshop',
    'Sexshop',
  ])
    expect(labels).toContain(label);
  for (const [kind, x, y] of [
    ['coffeeshop', 18, 22],
    ['sexshop', 42, 34],
    ['roy_merlin', 27, 21],
    ['chocolatier', 36, 24],
    ['farm', 23, 33],
    ['hotel', 37, 37],
    ['townhall', 25, 45],
  ] as const) {
    await page.evaluate(({ x, y }) => (window as any).scene.current.focusTile(x, y), { x, y });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const point = await page.evaluate(
      ({ x, y }) => {
        const c = (window as any).scene.current.cameras.main;
        const p = c.matrix.transformPoint((x - y) * 24 - c.scrollX, (x + y) * 12 - c.scrollY);
        return { x: p.x, y: p.y };
      },
      { x, y },
    );
    if (info.project.name === 'mobile') await page.touchscreen.tap(point.x, point.y);
    else await page.mouse.click(point.x, point.y);
    await expect(page.getByTestId('catalogue-selection')).toHaveText('building:' + kind);
  }
  await page.evaluate(() => {
    const s = (window as any).scene.current;
    s.cameras.main.centerOn(-70, 740).setZoom(s.scale.width > 700 ? 1 : 0.4);
  });
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.evaluate(() => {
    (window as any).scene.current.avatar.setVisible(false);
  });
  await page.getByTestId('catalogue-selection').evaluate((e) => {
    (e as HTMLElement).style.display = 'none';
  });
  await page.screenshot({ path: info.outputPath('nouveaux-batiments.png'), fullPage: true });
  expect(errors).toEqual([]);
});
