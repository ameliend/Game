import type { DemolitionProposal } from '../types';
import { BUILDINGS } from '../config/game';
import { countdown } from '../utils/rules';
export function DemolitionVotes({
  proposals = [],
  busy,
  now,
  onVote,
}: {
  proposals?: DemolitionProposal[];
  busy: boolean;
  now: number;
  onVote: (id: string, yes: boolean) => void;
}) {
  return (
    <section>
      <h3>Décisions de démolition</h3>
      <p>
        Accord unanime requis, habitants hors ligne compris. Le maire approuve en proposant. Un seul
        non refuse la démolition. Sans tous les accords sous 24 h, elle est refusée.
      </p>
      {!proposals.length && <p>Aucune démolition soumise au vote.</p>}
      {proposals.map((p) => (
        <article className="info-strip" key={p.id}>
          <div>
            <h3>
              {p.target_type === 'plot'
                ? 'Parcelle agricole'
                : p.snapshot.kind
                  ? BUILDINGS[p.snapshot.kind].name
                  : 'Bâtiment'}{' '}
              · {p.snapshot.x}, {p.snapshot.y}
            </h3>
            <p>
              Oui : {p.yes} / {p.elector_count} · Non : {p.no} ·{' '}
              {countdown(Date.parse(p.closes_at) - now)} restantes
            </p>
            {p.my_vote !== null ? (
              <p>Votre vote : {p.my_vote ? 'Oui' : 'Non'}</p>
            ) : p.can_vote ? (
              <div className="filters">
                <button
                  disabled={busy || Date.parse(p.closes_at) <= now}
                  onClick={() => onVote(p.id, true)}
                >
                  Oui, démolir
                </button>
                <button
                  disabled={busy || Date.parse(p.closes_at) <= now}
                  onClick={() => onVote(p.id, false)}
                >
                  Non, conserver
                </button>
              </div>
            ) : (
              <p>Vous ne participez pas à ce scrutin.</p>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}
