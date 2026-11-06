import { useEffect, useRef } from 'react';
import type { World } from '../types';
import { electionOpen } from '../utils/civic';
export function useArrivalVotes(
  world: World | null,
  userId: string | undefined,
  now: number,
  onOpen: () => void,
) {
  const shown = useRef(new Set<string>());
  const previousUser = useRef(userId);
  useEffect(() => {
    if (previousUser.current !== userId) {
      shown.current.clear();
      previousUser.current = userId;
    }
    if (!world || !userId || world.exile || (world.debt && Date.parse(world.debt.deadline) <= now))
      return;
    const g = world.governance;
    const votes = [
      ...(electionOpen(g?.election, now)
        ? [`election:${g!.election!.id}:${g!.election!.round}`]
        : []),
      ...(g?.exile_proposal?.status === 'open' && Date.parse(g.exile_proposal.closes_at) > now
        ? [`exile:${g.exile_proposal.id}:${g.exile_proposal.round}`]
        : []),
      ...(g?.demolition_proposals ?? [])
        .filter((p) => Date.parse(p.closes_at) > now)
        .map((p) => `demolition:${p.id}`),
    ].map((key) => `${userId}:${key}`);
    if (votes.some((key) => !shown.current.has(key))) {
      votes.forEach((key) => shown.current.add(key));
      onOpen();
    }
  }, [world, userId, now, onOpen]);
}
