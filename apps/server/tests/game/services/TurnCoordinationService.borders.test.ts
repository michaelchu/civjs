import { TurnCoordinationService } from '@game/services/TurnCoordinationService';

describe('TurnCoordinationService border updates', () => {
  it('recalculates once and includes players who have cities but no units', async () => {
    const borderManager = {
      recalculateAllBorders: jest.fn(() => ({
        tiles: [{ x: 1, y: 1 }],
        sources: [],
        removedSources: [],
        affectedPlayers: ['city-only-player'],
      })),
    };
    const cityManager = {
      getAllCities: jest.fn(() => [
        { id: 'city-1', playerId: 'city-only-player' },
        { id: 'city-2', playerId: 'unit-player' },
      ]),
    };
    const unitManager = {
      getAllUnits: jest.fn(() => new Map([['unit-1', { id: 'unit-1', playerId: 'unit-player' }]])),
    };
    const service = new TurnCoordinationService(
      'game-1',
      borderManager as any,
      {} as any,
      unitManager as any,
      cityManager as any
    );

    await service.updateBorders();

    expect(borderManager.recalculateAllBorders).toHaveBeenCalledTimes(1);
    expect(cityManager.getAllCities).toHaveBeenCalledTimes(1);
  });
});
