import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HarvestControls } from '../src/components/HarvestControls';
import { canMoveBuilding } from '../src/utils/property';
import type { Building, World } from '../src/types';
const plot = { id: 1, x: 30, y: 30, owner_id: 'alice', owner_name: 'Alice' };
it('indique qui possède la récolte et désactive le bouton pour les autres habitants', () => {
  const view = (userId: string) =>
    renderToStaticMarkup(
      <HarvestControls plot={plot} userId={userId} mature disabled={false} onHarvest={() => {}} />,
    );
  expect(view('bob')).toContain('Réservé à Alice');
  expect(view('bob')).toContain('disabled=""');
  expect(view('alice')).toContain('Récolter');
  expect(view('alice')).not.toContain('disabled=""');
});
it('identifie une parcelle commune et garde le contrôle de connexion', () => {
  const html = renderToStaticMarkup(
    <HarvestControls
      plot={{ ...plot, owner_id: null }}
      userId="bob"
      mature
      disabled
      onHarvest={() => {}}
    />,
  );
  expect(html).toContain('Parcelle commune');
  expect(html).toContain('disabled=""');
});
it('autorise les déplacements du maire et conserve les droits du constructeur et de l’administrateur', () => {
  const building = { created_by: 'builder' } as Building;
  const world = {
    profile: { id: 'mayor', is_admin: false },
    governance: { mayor_id: 'mayor' },
  } as World;
  expect(canMoveBuilding(world, building)).toBe(true);
  expect(canMoveBuilding({ ...world, profile: { ...world.profile, id: 'other' } }, building)).toBe(
    false,
  );
  expect(
    canMoveBuilding({ ...world, profile: { ...world.profile, id: 'builder' } }, building),
  ).toBe(true);
  expect(
    canMoveBuilding(
      { ...world, profile: { ...world.profile, id: 'admin', is_admin: true } },
      building,
    ),
  ).toBe(true);
  expect(canMoveBuilding({ ...world, exile: { until: new Date().toISOString() } }, building)).toBe(
    false,
  );
});
