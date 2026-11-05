import { expect, it } from 'vitest';
import { residentOffset } from '../src/utils/residents';
import { buildable, walkable } from '../src/utils/rules';
import type { World } from '../src/types';
it('sépare les autres avatars du joueur sur le même point d’arrivée', () => {
  const a = { id: 'alice', x: 30, y: 31 },
    b = { id: 'bob', x: 30, y: 31 },
    self = { x: 30, y: 31 };
  const first = residentOffset(a, [a, b], self),
    second = residentOffset(b, [a, b], self);
  expect(first.x).not.toBe(0);
  expect(second.x).not.toBe(0);
  expect(first.x).not.toBe(second.x);
  expect(residentOffset(a, [b, a], self)).toEqual(first);
});
it('ne décale pas un avatar seul sur une autre case', () => {
  const a = { id: 'alice', x: 31, y: 31 };
  expect(residentOffset(a, [a], { x: 30, y: 31 }).x).toBe(0);
});
it('libère immédiatement un ancien emplacement d’arbre coupé, sans attendre la repousse', () => {
  const world = {
    trees: [{ id: 1, x: 30, y: 30, cut_at: new Date().toISOString() }],
    plots: [],
    buildings: [],
  } as unknown as World;
  expect(buildable(world, 30, 30, 1)).toBe(true);
  expect(walkable(world, 30, 30)).toBe(true);
  world.trees[0].cut_at = null;
  expect(buildable(world, 30, 30, 1)).toBe(false);
  expect(walkable(world, 30, 30)).toBe(false);
});
