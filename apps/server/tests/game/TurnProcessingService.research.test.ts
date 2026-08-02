import { TurnProcessingService } from '@game/services/TurnProcessingService';

describe('TurnProcessingService research processing', () => {
  /**
   * @evidence parity
   * @reference reference/freeciv/server/techtools.c:650-719
   * @assertion A player's per-turn city science contributions are summed before research completion is evaluated.
   */
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
      calculateTechnologyUpkeep: jest.fn().mockReturnValue(0),
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

  it('sells an improvement when upkeep would make the treasury negative', async () => {
    const city = {
      id: 'city-1',
      playerId: 'player-1',
      tradePerTurn: 0,
      goldPerTurn: 0,
      buildings: ['cathedral'],
      grossProductionPerTurn: 1,
      unitShieldUpkeep: 0,
    };
    const cityManager = {
      getCitiesByPlayer: jest.fn().mockReturnValue([city]),
      sellBuilding: jest.fn().mockResolvedValue(true),
      calculateCityOutputs: jest.fn(),
    };
    const unitManager = {
      getPlayerUnits: jest.fn().mockReturnValue([]),
    };
    const economicOutput = {
      cityId: city.id,
      playerId: city.playerId,
      totalGoldProduced: 0,
      rawTrade: 0,
      costs: { buildingUpkeep: 3, unitUpkeep: 0, total: 3 },
      netGoldContribution: -3,
    };
    const economicManager = {
      calculateCityEconomicOutput: jest.fn().mockReturnValue(economicOutput),
      getPlayerGold: jest.fn().mockResolvedValue(0),
      addPlayerGold: jest.fn().mockResolvedValue(true),
      processTurnEconomics: jest.fn().mockResolvedValue({}),
    };
    const service = new TurnProcessingService(
      'game-1',
      unitManager as never,
      cityManager as never,
      {} as never,
      economicManager as never
    );

    await expect(service.processPlayerEconomics(city.playerId, 3)).resolves.toBe(true);

    expect(cityManager.sellBuilding).toHaveBeenCalledWith(city.id, 'cathedral');
    expect(economicManager.addPlayerGold).toHaveBeenCalledWith(
      city.playerId,
      expect.any(Number),
      'Insolvency building sale',
      expect.objectContaining({ cityId: city.id, turn: 3 })
    );
  });

  it('disbands a unit when its home city cannot pay shield upkeep', async () => {
    const city = {
      id: 'city-1',
      playerId: 'player-1',
      tradePerTurn: 0,
      goldPerTurn: 0,
      buildings: [],
      grossProductionPerTurn: 0,
      unitShieldUpkeep: 1,
    };
    const cityManager = {
      getCitiesByPlayer: jest.fn().mockReturnValue([city]),
      calculateCityOutputs: jest.fn(),
    };
    const unitManager = {
      getPlayerUnits: jest.fn().mockReturnValue([
        {
          id: 'warrior-1',
          playerId: city.playerId,
          unitTypeId: 'warriors',
          homeCityId: city.id,
        },
      ]),
      removeUnit: jest.fn().mockResolvedValue(undefined),
    };
    const economicManager = {
      calculateCityEconomicOutput: jest.fn().mockReturnValue({
        cityId: city.id,
        playerId: city.playerId,
        costs: { buildingUpkeep: 0, unitUpkeep: 0, total: 0 },
        netGoldContribution: 0,
      }),
      getPlayerGold: jest.fn().mockResolvedValue(0),
      processTurnEconomics: jest.fn().mockResolvedValue({}),
    };
    const service = new TurnProcessingService(
      'game-1',
      unitManager as never,
      cityManager as never,
      {} as never,
      economicManager as never
    );

    await service.processPlayerEconomics(city.playerId, 3);

    expect(unitManager.removeUnit).toHaveBeenCalledWith('warrior-1');
    expect(cityManager.calculateCityOutputs).toHaveBeenCalledWith(city.id);
  });
});
