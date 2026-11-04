import { useState } from 'react';
import type { Building, Player } from '../types';
export function HouseAssignment({
  building,
  players,
  disabled,
  onAssign,
}: {
  building: Building;
  players: Player[];
  disabled: boolean;
  onAssign: (userId: string) => void;
}) {
  const [userId, setUserId] = useState('');
  if (building.assigned_at || building.assigned_to)
    return (
      <div className="assignment-status">
        <p>
          Maison attribuée à{' '}
          <strong>
            {players.find((p) => p.id === building.assigned_to)?.username ?? 'un ancien habitant'}
          </strong>
        </p>
        <small>Attribution définitive · non modifiable</small>
      </div>
    );
  return (
    <div>
      <label>
        Attribuer cette maison
        <select
          aria-label="Bénéficiaire de la maison"
          disabled={disabled}
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        >
          <option value="">Choisir un habitant</option>
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.username}
            </option>
          ))}
        </select>
      </label>
      <button className="primary" disabled={disabled || !userId} onClick={() => onAssign(userId)}>
        Attribuer définitivement
      </button>
      <small style={{ display: 'block', marginTop: 8 }}>
        Cette attribution ne pourra plus être changée ni retirée.
      </small>
    </div>
  );
}
