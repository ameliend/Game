import { useCallback, useState } from 'react';
export function transportFailure(error: unknown) {
  const code =
    error && typeof error === 'object' && 'code' in error ? String(error.code ?? '') : '';
  if (/^[0-9A-Z]{5}$/.test(code) || code.startsWith('PGRST')) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch|fetch failed|networkerror|network request failed|load failed|connection refused|timed? ?out|timeout|aborted/i.test(
    message,
  );
}
// Browser online/offline flags describe network adapters, not server reachability.
export function useServerConnection() {
  const [available, setAvailable] = useState(true);
  const success = useCallback(() => setAvailable(true), []);
  const failure = useCallback((e: unknown) => setAvailable(!transportFailure(e)), []);
  return { available, success, failure };
}
