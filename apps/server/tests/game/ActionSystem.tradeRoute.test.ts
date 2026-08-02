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
  it('requires the caravan to enter the destination city before establishing a route', async () => {
    const establishTradeRoute = jest.fn().mockResolvedValue(true);
    const getCityAt = jest.fn((x: number, y: number) =>
      x === 10 && y === 10 ? { id: 'partner-city', playerId: 'player-2' } : null
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

    expect(system.canUnitPerformAction(unit, ActionType.TRADE_ROUTE, 10, 10)).toBe(true);
    await expect(system.executeAction(unit, ActionType.TRADE_ROUTE, 10, 10)).resolves.toMatchObject(
      {
        success: true,
        unitDestroyed: true,
      }
    );
    expect(establishTradeRoute).toHaveBeenCalledWith('player-1', 'home-city', 10, 10);
  });
});
