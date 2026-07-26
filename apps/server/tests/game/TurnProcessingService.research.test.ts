import { TurnProcessingService } from '@game/services/TurnProcessingService';

describe('TurnProcessingService research processing', () => {
  it('adds the sum of the player city science outputs to research', async () => {
    const cityManager = {
      getPlayerCities: jest
        .fn()
        .mockReturnValue([
          { sciencePerTurn: 2 },
          { sciencePerTurn: 3 },
          { sciencePerTurn: undefined },
        ]),
    };
    const researchManager = {
      addResearchPoints: jest.fn().mockResolvedValue(null),
    };
    const service = new TurnProcessingService(
      'game-1',
      {} as never,
      cityManager as never,
      researchManager as never
    );

    // @reference reference/freeciv/server/techtools.c:650-719
    await expect(service.processResearch('player-1')).resolves.toBe(false);
    expect(researchManager.addResearchPoints).toHaveBeenCalledWith('player-1', 5);
  });
});

describe('TurnProcessingService economic processing', () => {
  it('uses authoritative city gold and ruleset building upkeep', async () => {
    const cityManager = {
      getCitiesByPlayer: jest.fn().mockReturnValue([
        {
          id: 'city-1',
          tradePerTurn: 10,
          goldPerTurn: 8,
          buildings: ['library', 'cathedral'],
        },
      ]),
    };
    const economicOutput = {
      cityId: 'city-1',
      playerId: 'player-1',
      totalGoldProduced: 8,
      rawTrade: 10,
      costs: { buildingUpkeep: 4, unitUpkeep: 0, total: 4 },
      netGoldContribution: 4,
    };
    const economicManager = {
      calculateCityEconomicOutput: jest.fn().mockReturnValue(economicOutput),
      processTurnEconomics: jest.fn().mockResolvedValue({}),
    };
    const service = new TurnProcessingService(
      'game-1',
      {} as never,
      cityManager as never,
      {} as never,
      economicManager as never
    );

    await expect(service.processPlayerEconomics('player-1', 3)).resolves.toBe(true);
    expect(economicManager.calculateCityEconomicOutput).toHaveBeenCalledWith(
      'city-1',
      'player-1',
      10,
      0,
      4,
      0,
      8
    );
    expect(economicManager.processTurnEconomics).toHaveBeenCalledWith(
      'player-1',
      [economicOutput],
      3
    );
  });
});
