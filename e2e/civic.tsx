import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CivicPanel } from '../src/components/CivicPanel';
import { Modal } from '../src/components/Modal';
import { useArrivalVotes } from '../src/hooks/useArrivalVotes';
import type { World } from '../src/types';
import '../src/style.css';
const now = Date.now(),
  end = new Date(now + 86400000).toISOString();
const initial: World = {
  island: { id: 'test', owner_id: '', name: 'Test', gold: 150, score: 0 },
  profile: { id: 'cam', username: 'Cam', tutorial_step: 5, is_admin: false },
  avatar: { skin: '#fff', hair: '#fff', shirt: '#fff', pants: '#fff' },
  trees: [],
  plots: [],
  plantations: [],
  buildings: [],
  inventory: {},
  server_time: new Date(now).toISOString(),
  treasury: 30,
  governance: {
    mayor_id: 'alice',
    epoch: new Date(now).toISOString(),
    regime: 'capitalism',
    election: {
      id: 'election',
      starts_at: new Date(now - 1000).toISOString(),
      closes_at: end,
      finalized_at: null,
      winner_id: null,
      result: null,
      my_vote: null,
      can_vote: true,
      candidates: [
        { id: 'alice', username: 'Alice', votes: 0 },
        { id: 'cam', username: 'Cam', votes: 0 },
      ],
    },
    exile_proposal: {
      id: 'police',
      target_id: 'bob',
      target_name: 'Bobby',
      starts_at: new Date(now - 1000).toISOString(),
      closes_at: end,
      round: 1,
      status: 'open',
      yes: 0,
      no: 0,
      my_vote: null,
      can_vote: true,
      elector_count: 1,
      voted_count: 0,
    },
    demolition_proposals: [
      {
        id: 'demo',
        target_type: 'building',
        target_id: 'casino',
        snapshot: { kind: 'casino', x: 25, y: 25 },
        closes_at: end,
        status: 'open',
        yes: 2,
        no: 0,
        elector_count: 3,
        my_vote: null,
        can_vote: true,
      },
    ],
  },
};
function Fixture() {
  const [world, setWorld] = useState(initial),
    [open, setOpen] = useState(false),
    [result, setResult] = useState('');
  useArrivalVotes(world, 'cam', now, () => setOpen(true));
  return (
    <>
      <output data-testid="vote-result">{result}</output>
      <button onClick={() => setWorld({ ...world })}>Actualiser test</button>
      {open && (
        <Modal title="Votes en cours sur l’île" centered onClose={() => setOpen(false)}>
          <CivicPanel
            governance={world.governance}
            players={['alice', 'bob', 'cam'].map((id) => ({
              id,
              username: id,
              island_name: 'Test',
              island_id: 'test',
              score: 0,
              building_count: 0,
            }))}
            userId="cam"
            now={now}
            busy={false}
            treasury={30}
            onVote={(id) => {
              setResult('élection:' + id);
              setWorld({
                ...world,
                governance: {
                  ...world.governance!,
                  election: { ...world.governance!.election!, my_vote: id },
                },
              });
            }}
            onRegime={() => {}}
            onProposeExile={() => {}}
            onVoteExile={() => {
              setResult('exil:oui');
              setWorld({
                ...world,
                governance: {
                  ...world.governance!,
                  exile_proposal: {
                    ...world.governance!.exile_proposal!,
                    my_vote: true,
                    yes: 1,
                    voted_count: 1,
                    status: 'accepted',
                  },
                },
              });
            }}
            onVoteDemolition={() => {
              setResult('démolition:oui');
              setWorld({
                ...world,
                governance: { ...world.governance!, demolition_proposals: [] },
              });
            }}
          />
        </Modal>
      )}
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
