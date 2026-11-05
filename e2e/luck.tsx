import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LuckModal } from '../src/components/LuckModal';
import '../src/style.css';
function Fixture() {
  const [kind, setKind] = useState<'casino' | 'pol' | null>(null);
  const [calls, setCalls] = useState(0);
  return (
    <>
      <button onClick={() => setKind('casino')}>Casino test</button>
      <button onClick={() => setKind('pol')}>Pol test</button>
      <output data-testid="calls">{calls}</output>
      {kind && (
        <LuckModal
          key={kind}
          kind={kind}
          id="test"
          gold={100}
          available
          onClose={() => setKind(null)}
          onRefresh={async () => {}}
          request={async (_type, payload) => {
            setCalls((c) => c + 1);
            return { payout: payload.choice === 'safe' ? 50 : 25 };
          }}
        />
      )}
    </>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
