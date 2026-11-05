import type { Placement } from '../types';
export const repeatPlacement = (placement: NonNullable<Placement>) =>
  (placement.kind === 'road' || placement.kind === 'fence') && !placement.movingId;
