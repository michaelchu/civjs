import { calculatePartisanCount, shouldCreatePartisans } from '@game/services/PartisanService';

describe('PartisanService', () => {
  const alwaysZero = () => 0;
  const alwaysHigh = () => 0.999999;

  it('requires conquest of a city by its original owner with an active effect', () => {
    const eligible = {
      reason: 'conquest' as const,
      oldPlayerId: 'loser',
      originalOwnerId: 'loser',
      inspireEffect: 1,
    };

    expect(shouldCreatePartisans(eligible)).toBe(true);
    expect(shouldCreatePartisans({ ...eligible, reason: 'transfer' })).toBe(false);
    expect(shouldCreatePartisans({ ...eligible, originalOwnerId: 'founder' })).toBe(false);
    expect(shouldCreatePartisans({ ...eligible, inspireEffect: 0 })).toBe(false);
    expect(shouldCreatePartisans({ ...eligible, loserNation: 'barbarian' })).toBe(false);
  });

  it('matches the size roll and eight-unit cap', () => {
    expect(calculatePartisanCount(1, alwaysZero)).toBe(1);
    expect(calculatePartisanCount(20, alwaysHigh)).toBe(8);
  });
});
