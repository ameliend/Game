import { ExilePanel } from './ExilePanel';
import { CIVIC_RULES } from '../config/game';
import type { Governance, Player, Regime } from '../types';
import { countdown } from '../utils/rules';
import { electionOpen } from '../utils/civic';
export function CivicPanel({
  governance,
  players,
  userId,
  now,
  busy,
  onVote,
  onRegime,
  onProposeExile,
  onVoteExile,
}: {
  governance: Governance | undefined;
  players: Player[];
  userId: string;
  now: number;
  busy: boolean;
  onVote: (candidateId: string, electionId: string, round: number) => void;
  onRegime: (regime: Regime) => void;
  onProposeExile?: (id: string) => void;
  onVoteExile?: (id: string, round: number, yes: boolean) => void;
}) {
  const g = governance,
    e = g?.election,
    open = electionOpen(e, now),
    mayor = players.find((p) => p.id === g?.mayor_id);
  if (!g?.epoch)
    return (
      <div className="empty">
        Construisez une mairie pour ouvrir la première élection municipale.
      </div>
    );
  return (
    <div className="civic-panel">
      <div className="info-strip">
        <span style={{ fontSize: 30 }}>🏛️</span>
        <div>
          <h3>Maire : {mayor?.username ?? 'Poste vacant'}</h3>
          <p>
            Régime : <strong>{g.regime === 'capitalism' ? 'Capitalisme' : 'Communisme'}</strong>
          </p>
          <p>
            {g.regime === 'capitalism'
              ? 'Seul le constructeur peut récupérer le revenu de son commerce.'
              : 'Le premier habitant qui récupère la pièce garde le revenu.'}
          </p>
        </div>
      </div>
      {g.mayor_id === userId && (
        <fieldset>
          <legend>Choisir le régime économique</legend>
          <div className="filters">
            {(['communism', 'capitalism'] as const).map((mode) => (
              <button
                key={mode}
                disabled={busy || g.regime === mode}
                className={g.regime === mode ? 'active' : ''}
                onClick={() => onRegime(mode)}
              >
                {mode === 'communism' ? 'Communisme' : 'Capitalisme'}
              </button>
            ))}
          </div>
          <p className="muted">
            Le changement s’applique immédiatement aux pièces disponibles. Aucun solde n’est
            transféré.
          </p>
        </fieldset>
      )}
      <h3>{open ? '🗳️ Le scrutin est ouvert' : 'Les élections municipales'}</h3>
      {open && e ? (
        <>
          <p className="muted">
            {(e.round ?? 1) > 1 ? 'Égalité : nouveau tour d’une heure. ' : ''}Il reste{' '}
            {countdown(Date.parse(e.closes_at) - now)} pour voter. Un seul vote, définitif, pour un
            autre habitant.
          </p>
          {e.my_vote && (
            <p role="status" className="form-success">
              Votre vote pour{' '}
              {e.candidates.find((c) => c.id === e.my_vote)?.username ?? 'cet habitant'} est
              enregistré.
            </p>
          )}
          <div className="player-list">
            {e.candidates.map((c) => (
              <article key={c.id}>
                <div>
                  <h3>
                    {c.username}
                    {c.id === userId ? ' (vous)' : ''}
                  </h3>
                  <p>{c.votes} voix</p>
                </div>
                <button
                  className="secondary"
                  disabled={busy || Boolean(e.my_vote) || c.id === userId}
                  onClick={() => onVote(c.id, e.id, e.round ?? 1)}
                >
                  {c.id === userId
                    ? 'Vote pour soi interdit'
                    : e.my_vote === c.id
                      ? 'Votre choix'
                      : 'Voter'}
                </button>
              </article>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="muted">
            {e?.result === 'tie'
              ? 'Ancien scrutin clos à égalité. Le prochain scrutin est indiqué ci-dessous.'
              : e?.result === 'no_votes'
                ? 'Aucun vote : le maire sortant reste en fonction.'
                : e?.result === 'elected'
                  ? 'Le scrutin est terminé. Le maire élu est en fonction.'
                  : 'Le scrutin est fermé.'}
          </p>
          {e && (
            <p>
              Prochain scrutin dans{' '}
              {countdown(
                Date.parse(
                  g.next_election_at ??
                    new Date(Date.parse(e.closes_at) + CIVIC_RULES.electionEveryMs).toISOString(),
                ) - now,
              )}
            </p>
          )}
        </>
      )}
      {g.term_ends_at && (
        <p className="muted">Fin du mandat : {new Date(g.term_ends_at).toLocaleString('fr-FR')}</p>
      )}
      {onProposeExile && onVoteExile && (
        <ExilePanel
          proposal={g.exile_proposal}
          players={players}
          userId={userId}
          isMayor={g.mayor_id === userId}
          now={now}
          busy={busy}
          onPropose={onProposeExile}
          onVote={onVoteExile}
        />
      )}
      <p className="hint">
        Mandat d’une semaine, puis nouveau scrutin de 24 h. En cas d’égalité, nouveau tour d’une
        heure. Les candidats sont les habitants inscrits à l’ouverture du scrutin.
      </p>
    </div>
  );
}
