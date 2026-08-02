import { ActionType } from '@app-types/shared/actions';
import { ActionSystem } from '@game/systems/ActionSystem';

function caravan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'caravan-1',
    gameId: 'game-1',
    playerId: 'player-1',
    unitTypeId: 'caravan',
    x: 10,
    y: 10,
    movementLeft: 1,
    health: 100,
    veteranLevel: 0,
    experience: 0,
    fortified: false,
    activity: { type: 'idle', turnsRemaining: 0, totalTurns: 0 },
    orders: [],
    homeCityId: 'home-city',
    ...overrides,
  } as any;
}

describe('ActionSystem trade-route actions', () => {
  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:639-647
   * @reference reference/freeciv/common/actions.c:225-233
   * @assertion Establish Trade Route consumes a Caravan with a home city when its target city is on the actor tile or an adjacent tile, including the exact one-fragment boundary.
   * @c2c3-action Establish Trade Route
   * @c2c3-scenario normal, boundary
   */
  it('allows a caravan to establish a route with an adjacent destination city', async () => {
    const establishTradeRoute = jest.fn().mockResolvedValue(true);
    const getCityAt = jest.fn((x: number, y: number) =>
      x === 11 && y === 10 ? { id: 'partner-city', playerId: 'player-2' } : null
    );
    const system = new ActionSystem('game-1', {
      foundCity: jest.fn(),
      requestPath: jest.fn(),
      establishTradeRoute,
      getCityAt,
    });

    const unit = caravan();
    expect(system.canUnitPerformAction(unit, ActionType.TRADE_ROUTE, 20, 10)).toBe(false);
    await expect(system.executeAction(unit, ActionType.TRADE_ROUTE, 20, 10)).resolves.toMatchObject(
      {
        success: false,
      }
    );
    expect(establishTradeRoute).not.toHaveBeenCalled();

    expect(system.canUnitPerformAction(unit, ActionType.TRADE_ROUTE, 11, 10)).toBe(true);
    await expect(system.executeAction(unit, ActionType.TRADE_ROUTE, 11, 10)).resolves.toMatchObject(
      {
        success: true,
        unitDestroyed: true,
      }
    );
    expect(establishTradeRoute).toHaveBeenCalledWith('player-1', 'home-city', 11, 10);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/actions.ruleset:639-647
   * @assertion Establish Trade Route rejects a Caravan with no home city or no remaining C2C3 movement fragment.
   * @c2c3-action Establish Trade Route
   * @c2c3-scenario rejected
   */
  it('rejects c2c3 trade routes without a home city or movement', async () => {
    const establishTradeRoute = jest.fn().mockResolvedValue(true);
    const system = new ActionSystem('game-1', {
      foundCity: jest.fn(),
      requestPath: jest.fn(),
      establishTradeRoute,
      getCityAt: (x: number, y: number) =>
        x === 11 && y === 10 ? { id: 'partner-city', playerId: 'player-2' } : null,
    });

    await expect(
      system.executeAction(caravan({ homeCityId: undefined }), ActionType.TRADE_ROUTE, 11, 10)
    ).resolves.toMatchObject({ success: false });
    await expect(
      system.executeAction(caravan({ movementLeft: 0 }), ActionType.TRADE_ROUTE, 11, 10)
    ).resolves.toMatchObject({ success: false });
    expect(establishTradeRoute).not.toHaveBeenCalled();
  });
});
