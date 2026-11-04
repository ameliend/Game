import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HouseAssignment } from '../src/components/HouseAssignment';
import type { Building, Player } from '../src/types';
const building: Building = { id: 'b', kind: 'cottage', x: 30, y: 30, size: 2 };
const player: Player = {
  id: 'u',
  username: 'Camille',
  island_id: 'i',
  island_name: 'Île',
  score: 0,
  building_count: 0,
};
it('affiche le bénéficiaire verrouillé sans sélecteur ni action de modification', () => {
  const html = renderToStaticMarkup(
    <HouseAssignment
      building={{ ...building, assigned_to: 'u', assigned_at: '2026-11-04T12:00:00Z' }}
      players={[player]}
      disabled={false}
      onAssign={() => {}}
    />,
  );
  expect(html).toContain('Camille');
  expect(html).toContain('Attribution définitive');
  expect(html).not.toContain('<select');
  expect(html).not.toContain('<button');
});
it('explique le caractère définitif et exige un bénéficiaire avant confirmation', () => {
  const html = renderToStaticMarkup(
    <HouseAssignment building={building} players={[player]} disabled={false} onAssign={() => {}} />,
  );
  expect(html).toContain('Attribuer définitivement');
  expect(html).toContain('ne pourra plus être changée ni retirée');
  expect(html).toContain('disabled=""');
});
