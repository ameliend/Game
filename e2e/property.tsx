// Isolated browser fixture: the same harvest component and move policy used by App.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HarvestControls } from '../src/components/HarvestControls';
import { canMoveBuilding } from '../src/utils/property';
import type { Building, World } from '../src/types';
import '../src/style.css';
function Fixture() {
  const [user, setUser] = useState('bob'),
    [common, setCommon] = useState(false),
    [harvests, setHarvests] = useState(0),
    [moves, setMoves] = useState(0);
  const world = {
    profile: { id: user, is_admin: false },
    governance: { mayor_id: 'mayor' },
  } as World;
  const building = { created_by: 'alice' } as Building;
  return (
    <main style={{ maxWidth: 600, padding: 20, margin: 'auto' }}>
      <h1>Parcelles et déplacements</h1>
      <div className="filters">
        {[
          ['alice', 'Alice'],
          ['bob', 'Bob'],
          ['mayor', 'Maire'],
        ].map(([id, label]) => (
          <button key={id} onClick={() => setUser(id)}>
            Vue {label}
          </button>
        ))}
      </div>
      <button onClick={() => setCommon((v) => !v)}>
        {common ? 'Passer en privée' : 'Passer en commune'}
      </button>
      <HarvestControls
        plot={{ id: 1, x: 30, y: 30, owner_id: common ? null : 'alice', owner_name: 'Alice' }}
        userId={user}
        mature
        disabled={false}
        onHarvest={() => setHarvests((v) => v + 1)}
      />
      <button
        className="primary"
        disabled={!canMoveBuilding(world, building)}
        onClick={() => setMoves((v) => v + 1)}
      >
        Déplacer gratuitement
      </button>
      <p>
        Récoltes : <output data-testid="harvests">{harvests}</output>
      </p>
      <p>
        Déplacements : <output data-testid="moves">{moves}</output>
      </p>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
