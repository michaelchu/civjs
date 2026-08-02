import {
  calculatePartisanCount,
  notifyPartisanLoss,
  shouldCreatePartisans,
} from '@game/services/PartisanService';

describe('PartisanService', () => {
  const alwaysZero = () => 0;
  const alwaysHigh = () => 0.999999;

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/script.lua:12-15
   * @reference reference/freeciv/data/default/default.lua:209-225
   * @assertion The inherited city-transfer hook creates partisans only for a conquest with active local support; peaceful transfer, non-original ownership, inactive effects, and barbarian losses do not qualify.
   * @c2c3-surface cities
   * @c2c3-surface-scenario normal, boundary
   * @c2c3-script-hook city_transferred
   */
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

  /**
   * @evidence parity
   * @reference reference/freeciv/data/default/default.lua:209-225
   * @assertion The inherited city-transfer hook rolls one through the size-derived partisan count and caps it at eight units.
   * @c2c3-surface cities
   * @c2c3-surface-scenario boundary
   * @c2c3-script-hook city_transferred
   */
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
