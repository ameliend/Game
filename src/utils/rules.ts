import { RULES } from '../config/game';
import type { World } from '../types';
export function cropState(
  plantedAt: string,
  now: number,
): 'sprout' | 'growing' | 'mature' | 'withered' {
  const age = now - Date.parse(plantedAt);
  if (age >= RULES.witherMs) return 'withered';
  if (age >= RULES.matureMs) return 'mature';
  return age < RULES.matureMs / 2 ? 'sprout' : 'growing';
}
export function countdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60]
    .map((v) => String(v).padStart(2, '0'))
    .join(':');
}
export function land(x: number, y: number) {
  return x >= 0 && y >= 0 && x < 30 && y < 30 && (x - 14.5) ** 2 / 169 + (y - 14.5) ** 2 / 144 <= 1;
}
export function buildable(world: World, x: number, y: number, size: number, movingId?: string) {
  for (let a = x; a < x + size; a++)
    for (let b = y; b < y + size; b++) {
      if (
        !land(a, b) ||
        world.trees.some((t) => t.x === a && t.y === b) ||
        world.plots.some((p) => p.x === a && p.y === b) ||
        world.buildings.some(
          (v) => v.id !== movingId && a >= v.x && a < v.x + v.size && b >= v.y && b < v.y + v.size,
        )
      )
        return false;
    }
  return true;
}
export function walkable(world: World, x: number, y: number) {
  return (
    land(x, y) &&
    !world.buildings.some(
      (b) => b.kind !== 'road' && x >= b.x && x < b.x + b.size && y >= b.y && y < b.y + b.size,
    ) &&
    !world.trees.some((t) => t.x === x && t.y === y)
  );
}
export function pathTo(
  world: World,
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const queue = [start],
    seen = new Set([`${start.x},${start.y}`]),
    parents = new Map<string, { x: number; y: number }>();
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    if (p.x === end.x && p.y === end.y) {
      const path = [];
      let n = p;
      while (n.x !== start.x || n.y !== start.y) {
        path.unshift(n);
        n = parents.get(`${n.x},${n.y}`)!;
      }
      return path;
    }
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const n = { x: p.x + dx, y: p.y + dy },
        k = `${n.x},${n.y}`;
      if (!seen.has(k) && walkable(world, n.x, n.y)) {
        seen.add(k);
        parents.set(k, p);
        queue.push(n);
      }
    }
  }
  return [];
}
