// Isolated graphics/click fixture; production never imports these test residents or timestamps.
import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GameCanvas } from '../src/game/GameCanvas';
import { IslandScene } from '../src/game/IslandScene';
import { BUILDINGS } from '../src/config/game';
import type { BuildingKind } from '../src/config/game';
import type { World } from '../src/types';
import '../src/style.css';
const built = new Date(Date.now() - 25 * 3600000).toISOString();
const now = new Date().toISOString();
const shops: [BuildingKind, number, number][] = [
  ['casino', 25, 18],
  ['bakery', 22, 22],
  ['supermarket', 30, 20],
  ['butcher', 38, 22],
  ['pharmacy', 22, 30],
  ['barber', 30, 30],
  ['nail_salon', 38, 30],
  ['restaurant', 24, 38],
  ['townhall', 34, 38],
  ['cottage', 17, 25],
  ['house', 17, 34],
  ['farm', 26, 45],
  ['school', 40, 36],
  ['hospital', 36, 44],
];
const world: World = {
  pol: { id: 'pol-test', x: 28, y: 28, until: new Date(Date.now() + 86400000).toISOString() },
  island: { id: 'test', owner_id: 'test', name: 'Test des commerces', gold: 100, score: 0 },
  profile: { id: 'self', username: 'Test', tutorial_step: 5, is_admin: false },
  avatar: { skin: '#dba77c', hair: '#754d32', shirt: '#eaa66d', pants: '#486f70' },
  trees: [],
  plots: [],
  plantations: [],
  inventory: {},
  server_time: now,
  buildings: shops.map(([kind, x, y]) => ({
    id: kind,
    kind,
    x,
    y,
    size: BUILDINGS[kind].size,
    built_at: built,
    created_by: 'self',
    income_claimed_cycle: 0,
    assigned_to: kind === 'house' ? 'other' : null,
  })),
  governance: {
    regime: 'communism',
    mayor_id: null,
    epoch: now,
    election: {
      id: 'test-election',
      starts_at: now,
      closes_at: new Date(Date.now() + 86400000).toISOString(),
      finalized_at: null,
      winner_id: null,
      result: null,
      candidates: [],
      my_vote: null,
    },
  },
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
        onPlace={() => {}}
        onPosition={() => {}}
        guests={[]}
        sceneRef={ref}
      />
      <output
        data-testid="commerce-selection"
        style={{ position: 'absolute', top: 10, left: 10, background: 'white', padding: 10 }}
      >
        {selection}
      </output>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
