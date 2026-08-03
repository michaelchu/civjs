import { FreecivAdvisorService } from '@game/services/AdvisorService';

describe('FreecivAdvisorService', () => {
  it('returns shared economy, research, city, worker, exploration, and military advice read-only', async () => {
    const city = {
      id: 'capital',
      playerId: 'human',
      x: 0,
      y: 0,
      size: 4,
      population: 4,
      goldPerTurn: 2,
      foodPerTurn: 0,
      productionPerTurn: 5,
      tradePerTurn: 6,
      productionStock: 0,
      shieldStock: 0,
      buildings: [],
      specialists: {},
      happiness: { happy: 1, content: 3, unhappy: 0, angry: 0 },
      workableTiles: [],
      tradeRoutes: [],
    };
    const player = {
      id: 'human',
      userId: 'user',
      isAI: false,
      gold: 80,
      aiTraits: { expansionist: 50, trader: 50, aggressive: 50, builder: 50 },
    };
    const unreachableEnemy = {
      id: 'enemy-unit',
      playerId: 'enemy',
      unitTypeId: 'warriors',
      x: 1,
      y: 0,
      health: 100,
      veteranLevel: 0,
      movementLeft: 1,
    };
    const findPath = jest.fn().mockResolvedValue({
      valid: false,
      path: [],
      totalCost: 0,
      estimatedTurns: 0,
    });
    const tile = {
      x: 0,
      y: 0,
      terrain: 'grassland',
      riverMask: 0,
      elevation: 0,
      continentId: 1,
      owner: 'human',
      improvements: [],
      hasRoad: false,
      hasRailroad: false,
    };
    const game = {
      id: 'game',
      config: { ruleset: 'civ2civ3' },
      currentTurn: 12,
      players: new Map([
        ['human', player],
        [
          'enemy',
          {
            id: 'enemy',
            userId: 'enemy-user',
            isAI: false,
            gold: 0,
            aiTraits: { expansionist: 50, trader: 50, aggressive: 50, builder: 50 },
          },
        ],
      ]),
      cityManager: {
        getPlayerCities: () => [city],
        getAllCities: () => [city],
        canCityContinueProduction: (_cityId: string, kind: string, id: string) =>
          kind === 'building' && id === 'granary',
        calculateBuyCost: () => ({ canBuy: false, goldCost: 0 }),
      },
      unitManager: {
        getVisibleUnits: () => [unreachableEnemy],
        getPlayerUnits: () => [],
        getUnit: (unitId: string) =>
          unitId === unreachableEnemy.id ? unreachableEnemy : undefined,
        getUnitType: (unitTypeId: string) =>
          unitTypeId === 'warriors'
            ? {
                id: 'warriors',
                attack: 2,
                defense: 1,
                movement: 1,
                firepower: 1,
                hitpoints: 10,
                flags: [],
                rulesetUnitClassFlags: ['CanOccupyCity'],
              }
            : undefined,
        calculateUnitDefenseRating: () => 0,
        calculateUnitAttackRating: () => 20,
        calculateCityDefenseBonusAgainst: () => 0,
      },
      visibilityManager: {
        getVisibleTiles: () => new Set(['0,0']),
        getDetectionTiles: () => ({ invisible: new Set(), subsurface: new Set() }),
        getExploredTiles: () => new Set(['0,0']),
        isTileExplored: () => true,
      },
      researchManager: {
        getPlayerResearch: () => ({
          researchedTechs: new Set<string>(),
          bulbsAccumulated: 0,
          bulbsLastTurn: 0,
        }),
        getTechnologyCatalogue: () => [
          {
            id: 'alphabet',
            name: 'Alphabet',
            cost: 10,
            requirements: [],
            flags: [],
          },
        ],
        getAvailableTechnologies: () => [
          {
            id: 'alphabet',
            name: 'Alphabet',
            cost: 10,
            requirements: [],
            flags: [],
          },
        ],
      },
      turnManager: {
        getEconomicManager: () => ({
          getPlayerEconomicStatus: async () => ({
            currentGold: 80,
            taxRates: { tax: 40, luxury: 0, science: 60 },
          }),
        }),
      },
      mapManager: {
        getMapData: () => ({
          width: 1,
          height: 1,
          tiles: [[tile]],
          startingPositions: [],
          seed: 'advisor',
          generatedAt: new Date(0),
        }),
        getTile: () => tile,
        getNeighbors: () => [],
        getDistance: () => 0,
        getTopology: () => ({
          getCardinalNeighbors: () => [],
          squaredDistance: () => 0,
        }),
      },
      pathfindingManager: {
        findPath,
      },
    };
    const before = JSON.stringify({ city, player });
    const service = new FreecivAdvisorService({
      getRelationPlayerIds: async () => ({
        hostile: new Set(['enemy']),
        allied: new Set(),
        unknown: new Set(),
      }),
    } as any);

    const advice = await service.getRecommendations(game as any, 'human');

    expect(advice).toMatchObject({
      playerId: 'human',
      turn: 12,
      economy: {
        reserve: expect.any(Number),
        rates: { tax: expect.any(Number), luxury: expect.any(Number), science: expect.any(Number) },
      },
      workers: [],
      exploration: [],
      military: [],
    });
    expect(advice.research[0]).toMatchObject({ technologyId: 'alphabet' });
    expect(advice.cities[0].production[0]).toMatchObject({
      kind: 'building',
      id: 'granary',
    });
    expect(advice.cities[0].danger).toBe(0);
    expect(findPath).toHaveBeenCalledWith(unreachableEnemy, city.x, city.y);
    expect(JSON.stringify({ city, player })).toBe(before);
  });
});
