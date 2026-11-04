// Isolated test fixture for real Phaser rendering; never imported by the application.
import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GameCanvas } from '../src/game/GameCanvas';
import { IslandScene } from '../src/game/IslandScene';
import type { World } from '../src/types';
import '../src/style.css';
const world: World = {
  island: { id: 'fixture', owner_id: 'test', name: 'Scène de test', gold: 100, score: 0 },
  profile: { id: 'test', username: 'Test', tutorial_step: 5, is_admin: false },
  avatar: { skin: '#dba77c', hair: '#754d32', shirt: '#eaa66d', pants: '#486f70' },
  inventory: { wood: 0 },
  server_time: new Date().toISOString(),
  trees: [{ id: 1, x: 6, y: 10, cut_at: null }],
  plots: [{ id: 1, x: 12, y: 12 }],
  plantations: [],
  buildings: [],
};
function Harness() {
  const ref = useRef<IslandScene | null>(null);
  const [selection, setSelection] = useState(''),
    [pos, setPos] = useState('15,16'),
    [place, setPlace] = useState(false);
  (window as any).scene = ref;
  return (
    <div className="game-shell">
      <GameCanvas
        world={world}
        placement={place ? { kind: 'cottage' } : null}
        offset={0}
        onSelect={(s) => setSelection(s.type + ':' + s.id)}
        onPlace={(x, y) => setSelection('place:' + x + ',' + y)}
        onPosition={(x, y) => setPos(x + ',' + y)}
        guests={[{ id: 'other', username: 'Autre habitant', x: 17, y: 17, avatar: world.avatar }]}
        sceneRef={ref}
      />
      <div style={{ position: 'absolute', bottom: 0, left: 0, background: 'white', padding: 10 }}>
        <output data-testid="selection">{selection}</output>
        <output data-testid="position">{pos}</output>
        <button onClick={() => setPlace(!place)}>Construction test</button>
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Harness />);
