import { expect, it } from 'vitest';
import { buildable, worldLand } from '../src/utils/rules';
import type { World } from '../src/types';
it('dessine un îlot de moins de trente cases et sans terrain constructible', () => {
  const world = {
    exile: { until: new Date(Date.now() + 86400000).toISOString() },
    trees: [],
    plots: [],
    buildings: [],
  } as unknown as World;
  let tiles = 0;
  for (let x = 0; x < 60; x++) for (let y = 0; y < 60; y++) if (worldLand(world, x, y)) tiles++;
  expect(tiles).toBeGreaterThan(1);
  expect(tiles).toBeLessThan(30);
  expect(worldLand(world, 30, 31)).toBe(true);
  expect(worldLand(world, 45, 45)).toBe(false);
  expect(buildable(world, 30, 30, 1)).toBe(false);
});
