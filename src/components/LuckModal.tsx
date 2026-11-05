import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { action } from '../services/game';

function Scratch({ payout }: { payout: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [revealed, setRevealed] = useState(false);
  const strokes = useRef(0);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#b8a575';
    ctx.fillRect(0, 0, 280, 120);
    ctx.fillStyle = '#382b48';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Grattez ici !', 140, 68);
  }, []);
  return (
    <div className="scratch-ticket">
      <div
        style={{
          position: 'relative',
          width: 280,
          height: 120,
          margin: '20px auto',
          background: '#553775',
          color: '#ffe49a',
          borderRadius: 16,
        }}
      >
        <strong
          style={{ display: 'grid', placeItems: 'center', height: '100%', fontSize: 28 }}
          aria-hidden={!revealed}
        >
          {payout} pièces !
        </strong>
        {!revealed && (
          <canvas
            ref={canvas}
            width={280}
            height={120}
            aria-label="Zone à gratter"
            style={{ position: 'absolute', inset: 0, touchAction: 'none', borderRadius: 16 }}
            onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
            onPointerMove={(e) => {
              if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
              const rect = e.currentTarget.getBoundingClientRect(),
                ctx = e.currentTarget.getContext('2d');
              if (!ctx) return;
              ctx.globalCompositeOperation = 'destination-out';
              ctx.beginPath();
              ctx.arc(
                ((e.clientX - rect.left) * 280) / rect.width,
                ((e.clientY - rect.top) * 120) / rect.height,
                22,
                0,
                Math.PI * 2,
              );
              ctx.fill();
              if (++strokes.current > 24) setRevealed(true);
            }}
          />
        )}
      </div>
      {!revealed && (
        <button className="secondary" onClick={() => setRevealed(true)}>
          Révéler le ticket
        </button>
      )}
      {revealed && (
        <p role="status">
          {payout === 0 ? 'Pas de gain cette fois.' : `Vous avez gagné ${payout} pièces !`} La mise
          était de 5 pièces.
        </p>
      )}
    </div>
  );
}

export function LuckModal({
  kind,
  id,
  gold,
  available,
  onClose,
  onRefresh,
  request = action,
}: {
  kind: 'casino' | 'pol';
  id: string;
  gold: number;
  available: boolean;
  onClose: () => void;
  onRefresh: () => Promise<unknown>;
  request?: typeof action;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [payout, setPayout] = useState<number | null>(null);
  const pending = useRef<{ request: string; choice: string } | null>(null);
  const inFlight = useRef(false);
  async function play(choice: string) {
    if (inFlight.current || payout !== null) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    pending.current ??= { request: crypto.randomUUID(), choice };
    try {
      const result = (await request(
        kind === 'casino' ? 'scratch' : 'pol_deal',
        { id, ...(kind === 'pol' ? { choice: pending.current.choice } : {}) },
        pending.current.request,
      )) as { payout: number };
      setPayout(result.payout);
      await onRefresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Le serveur ne répond pas. Réessayez le même choix.',
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title={kind === 'casino' ? 'La couille en or' : 'Pol l’affreux lutin'}
      onClose={onClose}
      centered={kind === 'casino'}
    >
      {kind === 'casino' ? (
        <>
          <p>Voulez-vous miser 5 pièces pour tenter votre chance ?</p>
          {payout === null ? (
            <button
              className="primary"
              disabled={busy || !available || gold < 5}
              onClick={() => void play('scratch')}
            >
              {busy ? 'Tirage…' : 'Miser 5 pièces'}
            </button>
          ) : (
            <Scratch payout={payout} />
          )}
          {gold < 5 && payout === null && <p>Il vous faut 5 pièces pour jouer.</p>}
        </>
      ) : (
        <>
          <p>Bonjour je suis Pol l’affreux lutin !</p>
          {payout === null ? (
            <>
              <p>
                Choisis : 50 sous garantis, ou une chance sur deux de gagner 100 sous (sinon 0). Un
                seul deal pour toute l’île !
              </p>
              <button
                className="primary"
                disabled={busy || !available}
                onClick={() => void play('safe')}
              >
                Prendre 50 sous sûrs
              </button>{' '}
              <button
                className="secondary"
                disabled={busy || !available}
                onClick={() => void play('risk')}
              >
                Tenter 100 sous à 50/50
              </button>
            </>
          ) : (
            <p role="status">
              {payout === 0 ? 'Perdu ! Aucun sou cette fois.' : `Tu as gagné ${payout} sous !`} Pol
              repart. À dans 4 à 5 jours !
            </p>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </Modal>
  );
}
