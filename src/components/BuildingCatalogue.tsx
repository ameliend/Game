import { useState } from 'react';
import { Coins, Plus } from 'lucide-react';
import { BUILDINGS } from '../config/game';
import type { BuildingKind } from '../config/game';
export function BuildingCatalogue({
  gold,
  available,
  onChoose,
  onRetry,
}: {
  gold: number;
  available: boolean;
  onChoose: (kind: BuildingKind) => void;
  onRetry: () => void;
}) {
  const [category, setCategory] = useState('Tous');
  return (
    <>
      <p className="muted">
        Un toit, un jardin, un lieu où se retrouver. Faites grandir votre île.
      </p>
      <div className="balance-line">
        <Coins size={18} />
        {gold} pièces disponibles
      </div>
      {!available && (
        <div className="form-error" role="alert">
          Le serveur ne répond pas. Les achats reprendront après reconnexion.
          <button className="secondary" onClick={onRetry}>
            Réessayer la connexion
          </button>
        </div>
      )}
      <div className="filters">
        {['Tous', 'Habitations', 'Commerces', 'Agriculture', 'Services', 'Décorations'].map((c) => (
          <button className={category === c ? 'active' : ''} key={c} onClick={() => setCategory(c)}>
            {c}
          </button>
        ))}
      </div>
      <div className="catalog">
        {Object.entries(BUILDINGS)
          .filter(([, b]) => category === 'Tous' || b.category === category)
          .map(([key, b]) => (
            <article key={key}>
              <div className={'building-art art-' + key}>
                <span>{b.icon}</span>
                <small>
                  {b.size} × {b.size}
                </small>
              </div>
              <div className="catalog-detail">
                <h3>{b.name}</h3>
                <p>
                  +{b.points} points de village
                  {key === 'farm' ? ' · Parcelles vendues séparément' : ''}
                </p>
                <button
                  className="buy-button"
                  aria-label={`Acheter ${b.name} pour ${b.price} pièces`}
                  title={
                    !available
                      ? 'Connexion au serveur indisponible'
                      : gold < b.price
                        ? `Il manque ${b.price - gold} pièces`
                        : 'Choisir un emplacement'
                  }
                  disabled={gold < b.price || !available}
                  onClick={() => onChoose(key as BuildingKind)}
                >
                  <Coins size={15} />
                  {b.price}
                  <Plus size={15} />
                </button>
              </div>
            </article>
          ))}
      </div>
      <p className="hint">
        Le montant est débité seulement après le placement. Déplacement gratuit.
      </p>
    </>
  );
}
