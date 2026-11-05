// Isolated visual fixture, never imported into the production game.
import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GameCanvas } from '../src/game/GameCanvas';
import type { IslandScene } from '../src/game/IslandScene';
import { BUILDINGS } from '../src/config/game';
import type { BuildingKind } from '../src/config/game';
import type { World } from '../src/types';
import '../src/style.css';
const plots: [BuildingKind, number, number][] = [
  ['coffeeshop', 18, 22],
  ['sexshop', 42, 34],
  ['gym', 16, 34],
  ['roy_merlin', 26, 20],
  ['chocolatier', 36, 24],
  ['farm', 22, 32],
  ['hotel', 36, 36],
  ['townhall', 24, 44],
];
const world: World = {
  island: { id: 'test', owner_id: 'test', name: 'Test du catalogue', gold: 100, score: 0 },
  profile: { id: 'self', username: 'Test', tutorial_step: 5, is_admin: false },
  avatar: { skin: '#dba77c', hair: '#754d32', shirt: '#eaa66d', pants: '#486f70' },
  trees: [],
  plots: [],
  plantations: [],
  inventory: {},
  server_time: new Date().toISOString(),
  buildings: plots.map(([kind, x, y]) => ({
    id: kind,
    kind,
    x,
    y,
    size: BUILDINGS[kind].size,
    created_by: 'self',
    built_at: new Date().toISOString(),
    income_claimed_cycle: 0,
  })),
};
function Fixture() {
  const ref = useRef<IslandScene | null>(null),
    [selection, setSelection] = useState('');
  (window as any).scene = ref;
  return (
    <div className="game-shell">
      <GameCanvas
        world={world}
        placement={null}
        offset={0}
        onSelect={(s) => setSelection(s.type + ':' + s.id)}
        onPosition={() => {}}
        onPlace={() => {}}
        guests={[]}
        sceneRef={ref}
      />
      <output
        data-testid="catalogue-selection"
        style={{ position: 'absolute', top: 10, left: 10, background: 'white', padding: 8 }}
      >
        {selection}
      </output>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
