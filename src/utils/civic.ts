import { CIVIC_RULES, isCommerce } from '../config/game';
import type { Building, Election, Regime } from '../types';
export function incomeStatus(building: Building, now: number, regime: Regime, userId: string) {
  const built = Date.parse(building.built_at ?? '');
  const cycle = Number.isFinite(built) ? Math.floor((now - built) / CIVIC_RULES.incomeMs) : 0;
  const ready =
    isCommerce(building.kind) && cycle >= 1 && cycle > (building.income_claimed_cycle ?? 0);
  return {
    ready,
    canClaim: ready && (regime === 'communism' || building.created_by === userId),
    remaining: Number.isFinite(built)
      ? Math.max(0, built + (Math.max(0, cycle) + 1) * CIVIC_RULES.incomeMs - now)
      : CIVIC_RULES.incomeMs,
  };
}
export const electionOpen = (e: Election | null | undefined, now: number) =>
  Boolean(e && !e.finalized_at && Date.parse(e.starts_at) <= now && now < Date.parse(e.closes_at));
