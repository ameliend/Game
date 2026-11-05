import type { Plot } from '../types';
import { canHarvestPlot } from '../utils/property';

export function HarvestControls({
  plot,
  userId,
  mature,
  disabled,
  onHarvest,
}: {
  plot: Plot;
  userId: string;
  mature: boolean;
  disabled: boolean;
  onHarvest: () => void;
}) {
  const allowed = canHarvestPlot(plot, userId);
  return (
    <div className="plot-ownership">
      <p>
        {plot.owner_id ? (
          <>
            Parcelle de <strong>{plot.owner_name ?? 'cet habitant'}</strong> · Récolte réservée
            {plot.owner_id === userId ? ' à vous' : ' au propriétaire'}.
          </>
        ) : (
          'Parcelle commune · Tout le monde peut récolter.'
        )}
      </p>
      {mature && (
        <button className="primary" disabled={disabled || !allowed} onClick={onHarvest}>
          {allowed ? 'Récolter' : `Réservé à ${plot.owner_name ?? 'son propriétaire'}`}
        </button>
      )}
    </div>
  );
}
