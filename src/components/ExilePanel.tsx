import { useState } from 'react';
import type { ExileProposal, Player } from '../types';
import { countdown } from '../utils/rules';
export function ExilePanel({
  proposal,
  players,
  userId,
  isMayor,
  now,
  busy,
  onPropose,
  onVote,
}: {
  proposal: ExileProposal | null | undefined;
  players: Player[];
  userId: string;
  isMayor: boolean;
  now: number;
  busy: boolean;
  onPropose: (id: string) => void;
  onVote: (id: string, round: number, yes: boolean) => void;
}) {
  const [target, setTarget] = useState('');
  const open = proposal?.status === 'open' && Date.parse(proposal.closes_at) > now;
  return (
    <section className="exile-panel">
      <h3>Police du village · Exil de 24 h</h3>
      <p className="muted">
        Le maire propose un habitant. Les autres votent oui ou non. L’exil est décidé à la majorité
        des suffrages exprimés ; sans vote il est refusé. Une égalité ouvre un nouveau tour d’une
        heure.
      </p>
      {isMayor && proposal?.status !== 'open' && (
        <div>
          <label>
            Habitant concerné
            <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={busy}>
              <option value="">Choisir un habitant</option>
              {players
                .filter((p) => p.id !== userId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.username}
                  </option>
                ))}
            </select>
          </label>
          <button
            className="secondary"
            disabled={busy || !target}
            onClick={() => onPropose(target)}
          >
            Proposer un vote d’exil
          </button>
        </div>
      )}
      {proposal && (
        <div className="info-strip">
          <div>
            <h3>
              {proposal.target_name} · tour {proposal.round}
            </h3>
            <p>
              Oui : {proposal.yes} · Non : {proposal.no}
            </p>
            {open ? (
              <>
                <p>
                  {proposal.voted_count ?? proposal.yes + proposal.no} /{' '}
                  {proposal.elector_count ?? '?'} habitants ont voté. Le maire et la personne visée
                  ne votent pas ; clôture dès que les autres ont tous voté.
                </p>
                <p>Fin du tour dans {countdown(Date.parse(proposal.closes_at) - now)}</p>
                {proposal.my_vote !== null ? (
                  <p>Votre vote : {proposal.my_vote ? 'Oui' : 'Non'}</p>
                ) : proposal.can_vote ? (
                  <div className="filters">
                    <button
                      disabled={busy}
                      onClick={() => onVote(proposal.id, proposal.round, true)}
                    >
                      Oui à l’exil de 24 h
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => onVote(proposal.id, proposal.round, false)}
                    >
                      Non
                    </button>
                  </div>
                ) : (
                  <p>Vous ne participez pas à ce vote.</p>
                )}
              </>
            ) : (
              <p>
                {proposal.status === 'open'
                  ? 'Clôture du vote en cours…'
                  : proposal.status === 'accepted'
                    ? 'Exil adopté pour 24 heures.'
                    : 'Exil refusé.'}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
