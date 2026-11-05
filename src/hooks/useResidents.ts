import { useCallback, useEffect, useRef, useState } from 'react';
import { client, rpc } from '../services/client';
import { RULES } from '../config/game';
import type { Resident } from '../types';
export const residentsService = {
  heartbeat: (x: number, y: number) => rpc('heartbeat_presence', { p_x: x, p_y: y }),
  list: () => rpc<Resident[]>('online_residents'),
  offline: () => rpc('leave_presence'),
};
// Database heartbeats provide authenticated identity and a polling fallback when a
// WebSocket cannot connect. A presence list never depends solely on a sync event.
export function useResidents(userId: string | undefined, spawn = RULES.spawn) {
  const [residents, setResidents] = useState<Resident[]>([]),
    [error, setError] = useState('');
  const position = useRef({ ...RULES.spawn }),
    publishRef = useRef<() => void>(() => {}),
    lastPublish = useRef(0),
    trailing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!userId) {
      setResidents([]);
      return;
    }
    let alive = true,
      reading = false,
      writing = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    position.current = { ...spawn };
    lastPublish.current = 0;
    const read = async () => {
      if (!alive || reading) return;
      reading = true;
      try {
        const rows = await residentsService.list();
        if (alive) {
          setResidents(rows);
          setError('');
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Connexion aux habitants interrompue');
      } finally {
        reading = false;
      }
    };
    const publish = async () => {
      if (!alive || writing) return;
      writing = true;
      const sent = { ...position.current };
      lastPublish.current = Date.now();
      try {
        await residentsService.heartbeat(sent.x, sent.y);
        await read();
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Connexion aux habitants interrompue');
      } finally {
        writing = false;
        if (alive && (position.current.x !== sent.x || position.current.y !== sent.y)) {
          clearTimeout(trailing.current);
          trailing.current = setTimeout(
            () => void publish(),
            Math.max(0, 300 - (Date.now() - lastPublish.current)),
          );
        }
      }
    };
    publishRef.current = () => void publish();
    const channel = client()
      .channel('resident-positions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player_presence' }, () => {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => void read(), 100);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void publish();
      });
    void publish();
    const heartbeat = setInterval(() => void publish(), 15000),
      poll = setInterval(() => void read(), 5000);
    const visible = () => {
      if (document.visibilityState === 'visible') void publish();
    };
    window.addEventListener('online', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      alive = false;
      clearInterval(heartbeat);
      clearInterval(poll);
      clearTimeout(refreshTimer);
      clearTimeout(trailing.current);
      publishRef.current = () => {};
      window.removeEventListener('online', visible);
      document.removeEventListener('visibilitychange', visible);
      void client().removeChannel(channel);
    };
  }, [userId, spawn.x, spawn.y]);
  const updatePosition = useCallback((x: number, y: number) => {
    position.current = { x, y };
    clearTimeout(trailing.current);
    const wait = Math.max(0, 300 - (Date.now() - lastPublish.current));
    trailing.current = setTimeout(() => publishRef.current(), wait);
  }, []);
  return { residents, error, updatePosition };
}
