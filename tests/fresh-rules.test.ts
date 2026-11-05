import { expect, it } from 'vitest';
import { CIVIC_RULES, MAIN_ISLAND } from '../src/config/game';
import { effectiveIncome, incomeStatus } from '../src/utils/civic';
import { repeatPlacement } from '../src/utils/placement';
import { land, walkable } from '../src/utils/rules';
import type { Building, World } from '../src/types';
const house: Building = {
  id: 'h',
  kind: 'house',
  size: 3,
  x: 30,
  y: 30,
  created_by: 'builder',
  built_at: new Date(0).toISOString(),
};
it('n’affiche aucune pièce sur les maisons attribuées ni sur les mairies', () => {
  expect(
    incomeStatus({ ...house, assigned_to: 'owner' }, 86400000, 'communism', 'owner'),
  ).toMatchObject({ amount: 0, ready: false, canClaim: false });
  expect(effectiveIncome({ ...house, kind: 'townhall' })).toBe(0);
  expect(incomeStatus(house, 86400000, 'capitalism', 'builder')).toMatchObject({
    amount: 30,
    ready: true,
    canClaim: true,
  });
});
it('garde la pose continue pour routes et clôtures mais pas pour un déplacement', () => {
  expect(repeatPlacement({ kind: 'fence' })).toBe(true);
  expect(repeatPlacement({ kind: 'road' })).toBe(true);
  expect(repeatPlacement({ kind: 'fence', movingId: 'b' })).toBe(false);
  expect(repeatPlacement({ kind: 'house' })).toBe(false);
});
it('les clôtures bloquent le passage, les routes restent praticables', () => {
  const world = {
    trees: [],
    buildings: [{ ...house, kind: 'fence', x: 30, y: 30, size: 1 }],
  } as unknown as World;
  expect(walkable(world, 30, 30)).toBe(false);
  world.buildings[0].kind = 'road';
  expect(walkable(world, 30, 30)).toBe(true);
});
it('réduit le terrain à 1476 cases et utilise le capitalisme par défaut', () => {
  let n = 0;
  for (let x = 0; x < 60; x++) for (let y = 0; y < 60; y++) if (land(x, y)) n++;
  expect(n).toBe(MAIN_ISLAND.tiles);
  expect(n).toBe(1476);
  expect(CIVIC_RULES.defaultRegime).toBe('capitalism');
});
it('respecte une horloge de revenu réinitialisée indépendamment de la construction', () => {
  const b = { ...house, income_started_at: new Date(86400000).toISOString() };
  expect(incomeStatus(b, 86400000, 'capitalism', 'builder').ready).toBe(false);
  expect(incomeStatus(b, 2 * 86400000, 'capitalism', 'builder').ready).toBe(true);
});
