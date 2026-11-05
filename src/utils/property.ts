import type { Building, Plot, World } from '../types';

export const canHarvestPlot = (plot: Plot, userId: string) =>
  !plot.owner_id || plot.owner_id === userId;

export const canMoveBuilding = (world: World, building: Building) =>
  !world.exile &&
  (world.profile.is_admin ||
    world.governance?.mayor_id === world.profile.id ||
    building.created_by === world.profile.id);
