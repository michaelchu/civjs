import {
  calculatePartisanCount,
  notifyPartisanLoss,
  shouldCreatePartisans,
} from '@game/services/PartisanService';

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

  it('notifies both players when partisans are created', () => {
    const emit = jest.fn();
    const io = { to: jest.fn(() => ({ emit })) } as any;

    notifyPartisanLoss(io, 'loser', 'winner', 'Rome');

    expect(io.to).toHaveBeenNthCalledWith(1, 'player:loser');
    expect(io.to).toHaveBeenNthCalledWith(2, 'player:winner');
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith('diplomacy_event', {
      message: 'The loss of Rome has inspired partisans!',
    });
  });
});
