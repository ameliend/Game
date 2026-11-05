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
  await expect.poll(() => page.evaluate(() => (window as any).scene.current.guests.size)).toBe(1);
  const tree = await coords(page, 21, 25);
  await click(tree.x, tree.y);
  await expect(page.getByTestId('selection')).toHaveText('tree:1');
  const ground = await coords(page, 31, 31);
  await click(ground.x, ground.y);
  await expect(page.getByTestId('position')).toHaveText('31,31');
  const plot = await coords(page, 27, 27);
  await click(plot.x, plot.y);
  await expect(page.getByTestId('selection')).toHaveText('plot:1');
  await page.getByRole('button', { name: 'Construction test' }).click();
  const build = await coords(page, 30, 30);
  await page.mouse.move(build.x, build.y);
  await click(build.x, build.y);
  await expect(page.getByTestId('selection')).toHaveText('place:30,30');
  await page.getByRole('button', { name: 'Parcelle test' }).click();
  const farm = await coords(page, 32, 30);
  await click(farm.x, farm.y);
  await expect(page.getByTestId('selection')).toHaveText('place:32,30');
  await page.screenshot({ path: info.outputPath('map.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('les raccourcis du jeu ne bloquent pas la saisie de texte', async ({ page }) => {
  await page.goto('/e2e/map.html');
  await page.waitForFunction(() => Boolean((window as any).scene.current?.sys?.isActive()));
  const message = 'AZdsqw azDSQW Bonjour les voisins !';
  for (const label of ['Message de test', 'Texte de test']) {
    const field = page.getByRole('textbox', { name: label });
    await field.click();
    await field.pressSequentially(message);
    await expect(field).toHaveValue(message);
    await expect(page.getByTestId('position')).toHaveText('30,31');
  }
  await page
    .getByRole('textbox', { name: 'Texte de test' })
    .evaluate((e) => (e as HTMLElement).blur());
  await page.keyboard.press('ArrowUp', { delay: 220 });
  await expect(page.getByTestId('position')).not.toHaveText('30,31');
});

test('les avatars superposés restent visibles et un arbre coupé ne laisse pas de souche', async ({
  page,
}) => {
  await page.goto('/e2e/map.html');
  await page.waitForFunction(() => Boolean((window as any).scene.current?.sys?.isActive()));
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = (window as any).scene.current,
          g = s.guests.get('other');
        return g ? Math.abs(g.x - s.avatar.x) : 0;
      }),
    )
    .toBeGreaterThan(20);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = (window as any).scene.current,
          g = s.guests.get('other');
        return g?.list.some((o: any) => o.text === 'Autre habitant');
      }),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Déplacer autre habitant' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).scene.current.guests.get('other')?.x))
    .toBe((35 - 32) * 24);
  await page.getByRole('button', { name: 'Déconnecter autre habitant' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).scene.current.guests.size)).toBe(0);
  await page.getByRole('button', { name: 'Coupe test' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => Boolean((window as any).scene.current.objects.getByName('tree:1'))),
    )
    .toBe(false);
});

test('pose plusieurs carrés de route sans quitter le mode construction', async ({ page }) => {
  await page.goto('/e2e/map.html');
  await page.waitForFunction(() => Boolean((window as any).scene.current?.sys?.isActive()));
  await page.getByRole('button', { name: 'Mode route' }).click();
  for (const [x, y] of [
    [32, 30],
    [33, 30],
    [34, 30],
  ]) {
    const p = await coords(page, x, y);
    await page.mouse.click(p.x, p.y);
    await expect(page.getByTestId('selection')).toHaveText(`place:${x},${y}`);
    await expect(page.getByTestId('placement-mode')).toHaveText('road');
  }
});

test('l’îlot temporaire remplace la grande carte et ne contient aucune ressource', async ({
  page,
}) => {
  await page.goto('/e2e/map.html');
  await page.waitForFunction(() => Boolean((window as any).scene.current?.sys?.isActive()));
  await page.getByRole('button', { name: 'Îlot test' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).scene.current.world.island.id))
    .toBe('exile:test');
  expect(
    await page.evaluate(() => {
      const s = (window as any).scene.current;
      return s.world.trees.length + s.world.plots.length + s.world.buildings.length;
    }),
  ).toBe(0);
  expect(await page.evaluate(() => (window as any).scene.current.cameras.main.zoom)).toBe(1.5);
  await page.evaluate(() => (window as any).scene.current.walk(45, 45));
  await expect(page.getByTestId('position')).toHaveText('30,31');
});
