import { expect, it } from 'vitest';
import {
  buildable,
  exileLand,
  land,
  walkable,
  worldLand,
  pathTo,
  playerSpawn,
} from '../src/utils/rules';
import { EXILE_ISLAND, RULES } from '../src/config/game';
import type { World } from '../src/types';
const empty = { trees: [], plots: [], buildings: [] } as unknown as World;
const exiled = { ...empty, exile: { until: new Date(Date.now() + 86400000).toISOString() } };
it('dessine exactement neuf cases carrées près de la côte, séparées par de l’eau', () => {
  const tiles: [number, number][] = [];
  for (let x = 0; x < 63; x++) for (let y = 0; y < 60; y++) if (exileLand(x, y)) tiles.push([x, y]);
  expect(tiles).toHaveLength(9);
  expect(new Set(tiles.map(([x]) => x)).size).toBe(3);
  expect(new Set(tiles.map(([, y]) => y)).size).toBe(3);
  for (const [x, y] of tiles) expect(land(x, y)).toBe(false);
  expect(land(52, 30)).toBe(true);
  expect(land(53, 30)).toBe(false);
  expect(worldLand(empty, 56, 30)).toBe(false);
  expect(worldLand(empty, 57, 30)).toBe(false);
  expect(worldLand(empty, 59, 30)).toBe(false);
  expect(worldLand(empty, 60, 30)).toBe(true);
  expect(worldLand(empty, 30, 31)).toBe(true);
  expect(worldLand(exiled, 30, 31)).toBe(true);
});
it('réserve le déplacement sur les neuf cases aux habitants en exil', () => {
  expect(playerSpawn(exiled)).toEqual(EXILE_ISLAND.spawn);
  expect(playerSpawn(empty)).toEqual(RULES.spawn);
  expect(walkable(exiled, 61, 30)).toBe(true);
  expect(walkable(exiled, 30, 31)).toBe(false);
  expect(walkable(empty, 61, 30)).toBe(false);
  expect(pathTo(exiled, EXILE_ISLAND.spawn, RULES.spawn)).toEqual([]);
  expect(pathTo(exiled, EXILE_ISLAND.spawn, { x: 60, y: 29 })).toHaveLength(2);
  expect(buildable(exiled, 61, 30, 1)).toBe(false);
  expect(buildable(empty, 61, 30, 1)).toBe(false);
});
