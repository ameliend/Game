import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CIVIC_RULES } from '../src/config/game';
import { incomeStatus, electionOpen } from '../src/utils/civic';
import { CivicPanel } from '../src/components/CivicPanel';
import type { Building, Election, Governance } from '../src/types';
const at = Date.parse('2026-11-05T12:00:00Z');
const b: Building = {
  id: 'shop',
  kind: 'bakery',
  x: 30,
  y: 30,
  size: 2,
  created_by: 'owner',
  built_at: new Date(at).toISOString(),
  income_claimed_cycle: 0,
};
it('la pièce apparaît exactement 24 heures après la construction', () => {
  expect(incomeStatus(b, at + CIVIC_RULES.incomeMs - 1, 'communism', 'guest').ready).toBe(false);
  expect(incomeStatus(b, at + CIVIC_RULES.incomeMs, 'communism', 'guest').canClaim).toBe(true);
});
it('le cycle suivant reste ancré à la construction', () => {
  const claimed = { ...b, income_claimed_cycle: 1 };
  expect(incomeStatus(claimed, at + CIVIC_RULES.incomeMs * 2 - 1, 'communism', 'guest').ready).toBe(
    false,
  );
  expect(incomeStatus(claimed, at + CIVIC_RULES.incomeMs * 2, 'communism', 'guest').ready).toBe(
    true,
  );
});
it('la pièce est visible en capitalisme mais réservée au constructeur', () => {
  expect(incomeStatus(b, at + CIVIC_RULES.incomeMs, 'capitalism', 'guest')).toMatchObject({
    ready: true,
    canClaim: false,
  });
  expect(incomeStatus(b, at + CIVIC_RULES.incomeMs, 'capitalism', 'owner').canClaim).toBe(true);
});
const e: Election = {
  id: 'e',
  starts_at: new Date(at).toISOString(),
  closes_at: new Date(at + CIVIC_RULES.votingMs).toISOString(),
  finalized_at: null,
  winner_id: null,
  result: null,
  my_vote: null,
  candidates: [
    { id: 'self', username: 'Moi', votes: 0 },
    { id: 'other', username: 'Camille', votes: 0 },
  ],
};
it('le scrutin est ouvert à son début et fermé exactement à 24h', () => {
  expect(electionOpen(e, at - 1)).toBe(false);
  expect(electionOpen(e, at)).toBe(true);
  expect(electionOpen(e, at + CIVIC_RULES.votingMs - 1)).toBe(true);
  expect(electionOpen(e, at + CIVIC_RULES.votingMs)).toBe(false);
});
it('l’interface propose les candidats et interdit le vote pour soi', () => {
  const g: Governance = { regime: 'communism', mayor_id: null, epoch: e.starts_at, election: e };
  const html = renderToStaticMarkup(
    <CivicPanel
      governance={g}
      players={[]}
      userId="self"
      now={at}
      busy={false}
      onVote={() => {}}
      onRegime={() => {}}
    />,
  );
  expect(html).toContain('Vote pour soi interdit');
  expect(html).toContain('Camille');
  expect(html).not.toContain('Choisir le régime économique');
});
it('seul le maire voit les commandes du régime économique', () => {
  const g: Governance = { regime: 'capitalism', mayor_id: 'self', epoch: e.starts_at, election: e };
  const html = renderToStaticMarkup(
    <CivicPanel
      governance={g}
      players={[]}
      userId="self"
      now={at}
      busy={false}
      onVote={() => {}}
      onRegime={() => {}}
    />,
  );
  expect(html).toContain('Choisir le régime économique');
  expect(html).toContain('Capitalisme');
  expect(html).toContain('Communisme');
});
