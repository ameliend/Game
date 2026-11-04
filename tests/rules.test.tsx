import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BUILDINGS, CROPS, HOURS, RULES } from '../src/config/game';
import { buildable, countdown, cropState, land, pathTo } from '../src/utils/rules';
import { MessageText } from '../src/components/Chat';
import type { World } from '../src/types';
const at = '2026-11-04T00:00:00Z',
  t = Date.parse(at);
const world = {
  island: { id: 'i', owner_id: 'u', name: 'Test', gold: 100, score: 10 },
  profile: { id: 'u', username: 'Test', tutorial_step: 5, is_admin: false },
  avatar: { skin: '#dba77c', hair: '#754d32', shirt: '#eaa66d', pants: '#486f70' },
  inventory: { wood: 0 },
  server_time: at,
  trees: [{ id: 1, x: 10, y: 10, cut_at: null }],
  plots: [{ id: 1, x: 12, y: 12 }],
  buildings: [{ id: 'b', kind: 'cottage', x: 16, y: 16, size: 2 }],
  plantations: [],
} as World;
describe('Agriculture : limites exactes', () => {
  it('ne peut être récoltée avant 8 h', () =>
    expect(cropState(at, t + 8 * HOURS - 1)).toBe('growing'));
  it('est mature exactement à 8 h', () => expect(cropState(at, t + 8 * HOURS)).toBe('mature'));
  it('reste mature jusqu’à 12 h exclues', () =>
    expect(cropState(at, t + 12 * HOURS - 1)).toBe('mature'));
  it('fane exactement à 12 h', () => expect(cropState(at, t + 12 * HOURS)).toBe('withered'));
  it('reste fanée après une longue déconnexion', () =>
    expect(cropState(at, t + 100 * HOURS)).toBe('withered'));
  it('formate les durées sans heures modulo 24', () => {
    expect(countdown(8 * HOURS)).toBe('08:00:00');
    expect(countdown(-1)).toBe('00:00:00');
    expect(countdown(1)).toBe('00:00:01');
  });
});
describe('Grille de construction et déplacements', () => {
  it('refuse l’eau et les limites', () => {
    expect(land(0, 0)).toBe(false);
    expect(buildable(world, 29, 29, 3)).toBe(false);
    expect(buildable(world, -1, 15, 1)).toBe(false);
  });
  it('refuse arbres, parcelles et chevauchement partiel', () => {
    expect(buildable(world, 10, 10, 1)).toBe(false);
    expect(buildable(world, 11, 11, 2)).toBe(false);
    expect(buildable(world, 15, 15, 2)).toBe(false);
  });
  it('autorise de déplacer une construction sur ses propres cases', () =>
    expect(buildable(world, 16, 16, 2, 'b')).toBe(true));
  it('autorise un terrain libre', () => expect(buildable(world, 14, 14, 2)).toBe(true));
  it('contourne une maison sans traverser ses murs', () => {
    const path = pathTo(world, { x: 15, y: 16 }, { x: 18, y: 16 });
    expect(path.length).toBeGreaterThan(3);
    expect(path.at(-1)).toEqual({ x: 18, y: 16 });
    expect(path.some((p) => p.x >= 16 && p.x < 18 && p.y >= 16 && p.y < 18)).toBe(false);
  });
  it('ne marche pas sur l’eau', () =>
    expect(pathTo(world, { x: 15, y: 15 }, { x: 0, y: 0 })).toEqual([]));
});
describe('Affichage sûr du chat', () => {
  it('échappe les scripts et attributs HTML', () => {
    const html = renderToStaticMarkup(
      <MessageText content={'<img src=x onerror="alert(1)"><script>alert(2)</script>'} />,
    );
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
describe('Configuration économique', () => {
  it('définit les prix et durées demandés', () => {
    expect(RULES.initialGold).toBe(100);
    expect(RULES.regrowMs).toBe(1_800_000);
    expect(CROPS.strawberry).toMatchObject({ seed: 35, price: 50, yield: 2 });
    expect(Object.keys(BUILDINGS)).toHaveLength(11);
  });
});
