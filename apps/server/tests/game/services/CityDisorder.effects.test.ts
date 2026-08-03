import { EffectsManager } from '@game/managers/EffectsManager';
import { CityTurnProcessingService } from '@game/services/CityTurnProcessingService';

describe('C2C3 civil disorder effects', () => {
  it('overthrows Democracy after more than two consecutive disorder turns', async () => {
    const forceGovernmentRevolution = jest.fn().mockResolvedValue(undefined);
    const service = new CityTurnProcessingService({
      effectsManager: new EffectsManager(),
      getPlayerGovernment: () => 'democracy',
      forceGovernmentRevolution,
    } as never);
    const city = {
      id: 'city-1',
      playerId: 'player-1',
      buildings: [],
      disorderTurns: 0,
    };

    await (service as any).processCivilDisorder(city, true);
    await (service as any).processCivilDisorder(city, true);
    expect(forceGovernmentRevolution).not.toHaveBeenCalled();

    await (service as any).processCivilDisorder(city, true);
    expect(forceGovernmentRevolution).toHaveBeenCalledWith('player-1');
    expect(city.disorderTurns).toBe(0);
  });

  it('resets the consecutive-turn counter when order is restored', async () => {
    const service = new CityTurnProcessingService({
      effectsManager: new EffectsManager(),
      getPlayerGovernment: () => 'democracy',
    } as never);
    const city = {
      id: 'city-1',
      playerId: 'player-1',
      buildings: [],
      disorderTurns: 2,
    };

    await (service as any).processCivilDisorder(city, false);

    expect(city.disorderTurns).toBe(0);
  });
});
