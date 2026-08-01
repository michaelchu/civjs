import { resolveNationGraphic } from '../../../src/game/services/NationPresentationService';

describe('NationPresentationService', () => {
  it('maps a ruleset nation id to the Amplio2 flag suffix', () => {
    expect(resolveNationGraphic('roman')).toBe('rome');
  });

  it('preserves an unknown legacy graphic suffix as a fallback', () => {
    expect(resolveNationGraphic('custom_flag')).toBe('custom_flag');
    expect(resolveNationGraphic('f.custom_flag')).toBe('custom_flag');
  });

  it('returns undefined for an absent nation id', () => {
    expect(resolveNationGraphic(undefined)).toBeUndefined();
    expect(resolveNationGraphic('')).toBeUndefined();
  });
});
