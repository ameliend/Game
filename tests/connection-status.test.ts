import { expect, it } from 'vitest';
import { transportFailure } from '../src/hooks/useServerConnection';
it('distingue une erreur SQL timeout d’une perte réelle du réseau', () => {
  expect(
    transportFailure(
      Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }),
    ),
  ).toBe(false);
  expect(transportFailure(Object.assign(new Error('missing function'), { code: 'PGRST202' }))).toBe(
    false,
  );
  expect(transportFailure(new TypeError('Failed to fetch'))).toBe(true);
  expect(transportFailure(new Error('Network request failed'))).toBe(true);
  expect(transportFailure(new Error('Fonds insuffisants'))).toBe(false);
});
