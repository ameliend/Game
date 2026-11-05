// Test-only page: actual HTTP probe against Vite, no fake accounts in the application.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BuildingCatalogue } from '../src/components/BuildingCatalogue';
import { useServerConnection } from '../src/hooks/useServerConnection';
import '../src/style.css';
function Shop() {
  const status = useServerConnection(),
    [selection, setSelection] = useState(''),
    [balance, setBalance] = useState(1000);
  const check = async () => {
    try {
      const r = await fetch('/index.html');
      if (!r.ok) throw Error('HTTP ' + r.status);
      status.success();
    } catch (e) {
      status.failure(e);
    }
  };
  useEffect(() => {
    void check();
    const changed = () => void check();
    window.addEventListener('offline', changed);
    window.addEventListener('online', changed);
    return () => {
      window.removeEventListener('offline', changed);
      window.removeEventListener('online', changed);
    };
  }, []);
  return (
    <main style={{ maxWidth: 760, margin: 'auto', padding: 20 }}>
      <output data-testid="selected">{selection}</output>
      <button onClick={() => status.failure(new TypeError('Failed to fetch'))}>
        Simuler une coupure
      </button>
      <button onClick={() => setBalance(0)}>Solde nul</button>
      <BuildingCatalogue
        gold={balance}
        available={status.available}
        onChoose={setSelection}
        onRetry={() => void check()}
      />
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Shop />);
