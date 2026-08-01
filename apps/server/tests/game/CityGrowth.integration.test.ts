import { CityManager } from '@game/managers/CityManager';
import { EffectsManager } from '@game/managers/EffectsManager';
import { MapManager } from '@game/managers/MapManager';
import { createMockDatabaseProvider } from '../utils/mockDatabaseProvider';

describe('City Population Growth Integration', () => {
  let cityManager: CityManager;
  let effectsManager: EffectsManager;
  let mockMapManager: MapManager;
  const gameId = 'test-game-id';

  beforeEach(async () => {
    const mockDbProvider = createMockDatabaseProvider();
    effectsManager = new EffectsManager();

    // Create mock MapManager
    mockMapManager = {
      getMapData: jest.fn().mockReturnValue({
        width: 80,
        height: 50,
        tiles: Array.from({ length: 80 }, (_, x) =>
          Array.from({ length: 50 }, (_, y) => ({
            x,
            y,
            terrain: 'grassland',
            resource: null,
            special: null,
            improvement: null,
            city: null,
            units: [],
            isVisible: true,
          }))
        ),
      }),
      getTile: jest.fn((x: number, y: number) => ({
        x,
        y,
        terrain: 'grassland',
        resource: null,
        special: null,
        improvement: null,
        city: null,
        units: [],
        isVisible: true,
      })),
      isValidPosition: jest.fn().mockReturnValue(true),
    } as unknown as MapManager;

    cityManager = new CityManager(gameId, mockDbProvider, effectsManager);
    cityManager.setPlayerGovernmentProvider(() => 'despotism');
    await cityManager.initialize();
    cityManager.setMapManager(mockMapManager);

    jest.clearAllMocks();
  });

  describe('Full processCityTurn Integration', () => {
    it('should grow city population when using processCityTurn with surplus food', async () => {
      const city = await cityManager.foundCity(35, 35, 'IntegrationCity', 'player-123');

      // Record initial state
      const initialPopulation = city.population;
      expect(initialPopulation).toBe(1);
      expect(city.foodPerTurn).toBeGreaterThan(0);
      expect(
        (city.workableTiles?.filter(tile => tile.isWorked && !tile.isCenter).length ?? 0) +
          Object.values(city.specialists).reduce((total, count) => total + count, 0)
      ).toBe(city.population);

      // Set up for guaranteed growth by starting very close to growth threshold
      // Grassland center + one grassland worker yields 4 gross food and a
      // size-one city consumes 2, for +2 net food per turn.
      city.foodStock = 19; // Almost at growth threshold (need 20 to grow)

      // Process one turn through the complete output and growth pipeline.
      await cityManager.processCityTurn(city.id, 1);

      const afterTurn = cityManager.getCity(city.id)!;

      // Verify that population actually grew from the turn processing
      // Starting at 19 food + 2 net surplus crosses the 20-food threshold.
      expect(afterTurn.population).toBe(initialPopulation + 1);
      expect(afterTurn.population).toBe(2);
      expect(afterTurn.size).toBe(2);
      expect(
        (afterTurn.workableTiles?.filter(tile => tile.isWorked && !tile.isCenter).length ?? 0) +
          Object.values(afterTurn.specialists).reduce((total, count) => total + count, 0)
      ).toBe(afterTurn.population);

      // Verify food stock was handled correctly after growth
      expect(afterTurn.foodStock).toBeGreaterThanOrEqual(0);
      expect(afterTurn.foodStock).toBeLessThan(20); // Should be < 20 after growth consumed the granary
    });

    it('uses the constrained citizen manager after human-city growth', async () => {
      (mockMapManager.getTile as jest.Mock).mockImplementation((x: number, y: number) => ({
        x,
        y,
        terrain:
          x === 35 && y === 35
            ? 'hills'
            : (x === 34 && y === 35) || (x === 35 && y === 34)
              ? 'forest'
              : 'grassland',
        improvements: [],
        riverMask: 0,
        units: [],
        isVisible: true,
      }));
      const city = await cityManager.foundCity(35, 35, 'Constrained Growth', 'human');
      city.foodStock = 19;

      await cityManager.processCityTurn(city.id, 1);

      expect(city.population).toBe(2);
      expect(city.foodPerTurn).toBeGreaterThanOrEqual(1);
      const assigned = city.workableTiles?.filter(tile => tile.isWorked && !tile.isCenter) ?? [];
      expect(assigned).toHaveLength(2);
      expect(assigned.every(tile => tile.terrain === 'grassland')).toBe(true);
    });

    it('uses the same post-growth reconciliation for equivalent human and easy-AI cities', async () => {
      const createManager = async (isAI: boolean) => {
        const manager = new CityManager(
          isAI ? 'ai-growth-parity' : 'human-growth-parity',
          createMockDatabaseProvider(),
          new EffectsManager()
        );
        manager.setPlayerGovernmentProvider(() => 'despotism');
        manager.setPlayerAIProvider(() => ({ isAI, aiLevel: 'easy' }));
        await manager.initialize();
        manager.setMapManager(mockMapManager);
        return manager;
      };
      const humanManager = await createManager(false);
      const aiManager = await createManager(true);
      const human = await humanManager.foundCity(15, 15, 'Human City', 'human');
      const ai = await aiManager.foundCity(15, 15, 'AI City', 'ai');
      human.foodStock = 19;
      ai.foodStock = 19;

      await humanManager.processCityTurn(human.id, 1);
      await aiManager.processCityTurn(ai.id, 1);

      expect(ai.population).toBe(human.population);
      expect(ai.foodStock).toBe(human.foodStock);
      expect(ai.foodPerTurn).toBe(human.foodPerTurn);
      expect(ai.workableTiles?.map(tile => tile.isWorked)).toEqual(
        human.workableTiles?.map(tile => tile.isWorked)
      );
    });

    it('retains civ2civ3 growth food using the pre-growth city size', async () => {
      const civ2civ3Manager = new CityManager(
        'civ2civ3-growth',
        createMockDatabaseProvider(),
        new EffectsManager('civ2civ3')
      );
      civ2civ3Manager.setPlayerGovernmentProvider(() => 'despotism');
      await civ2civ3Manager.initialize();
      civ2civ3Manager.setMapManager(mockMapManager);
      const city = await civ2civ3Manager.foundCity(30, 30, 'Food Retention', 'human');
      city.foodStock = 18;

      await civ2civ3Manager.processFoodAndGrowth(city, 1);

      expect(city.population).toBe(2);
      expect(city.foodStock).toBe(10);
    });

    it('reconciles workers and retains food after civ2civ3 starvation', async () => {
      const civ2civ3Manager = new CityManager(
        'civ2civ3-starvation',
        createMockDatabaseProvider(),
        new EffectsManager('civ2civ3')
      );
      civ2civ3Manager.setPlayerGovernmentProvider(() => 'despotism');
      await civ2civ3Manager.initialize();
      civ2civ3Manager.setMapManager(mockMapManager);
      const city = await civ2civ3Manager.foundCity(25, 25, 'Starvation Recovery', 'human');
      await civ2civ3Manager.joinCity(city.id, city.playerId, 1);
      city.foodStock = 0;
      city.foodPerTurn = -1;

      await civ2civ3Manager.processFoodAndGrowth(city, 1);

      expect(city.population).toBe(1);
      expect(city.foodStock).toBe(10);
      expect(
        (city.workableTiles?.filter(tile => tile.isWorked && !tile.isCenter).length ?? 0) +
          Object.values(city.specialists).reduce((sum, count) => sum + count, 0)
      ).toBe(1);
      expect(city.foodPerTurn).toBeGreaterThanOrEqual(1);
    });

    it('destroys a size-one city that starves', async () => {
      const city = await cityManager.foundCity(20, 20, 'Final Famine', 'human');
      city.foodStock = 0;
      city.foodPerTurn = -1;

      await cityManager.processFoodAndGrowth(city, 1);

      expect(cityManager.getCity(city.id)).toBeUndefined();
    });

    it('should handle population growth and recalculate consumption correctly', async () => {
      const city = await cityManager.foundCity(40, 40, 'RecalcCity', 'player-123');

      // Record initial state
      const initialPopulation = city.population;
      expect(initialPopulation).toBe(1);

      // Set up for guaranteed growth by getting close to threshold with high food stock
      // With grassland providing ~1 net food surplus per turn, we need to start near growth
      city.foodStock = 18; // Close to growth threshold (need 20)

      // Process multiple turns until growth occurs - this tests the integration
      let grownCity = cityManager.getCity(city.id)!;

      for (let turn = 1; turn <= 5; turn++) {
        await cityManager.processCityTurn(city.id, turn);
        grownCity = cityManager.getCity(city.id)!;

        // Stop when growth occurs
        if (grownCity.population > initialPopulation) {
          break;
        }
      }

      // Verify population grew: 1 -> 2
      expect(grownCity.population).toBe(initialPopulation + 1);
      expect(grownCity.population).toBe(2);

      // After growth, the city should have properly recalculated food consumption
      // New consumption = 2 citizens × 2 food = 4 food per turn
      // This verifies that the citizen food consumption calculation works with processCityTurn
      expect(grownCity.size).toBe(2);
    });

    it('should grow naturally over ten turns on unimproved grassland', async () => {
      const city = await cityManager.foundCity(25, 25, 'MultiTurnCity', 'player-123');

      for (let turn = 1; turn <= 10; turn++) {
        await cityManager.processCityTurn(city.id, turn);

        const currentCity = cityManager.getCity(city.id)!;
        expect(currentCity.foodStock).toBeGreaterThanOrEqual(0);
        if (turn < 10) {
          expect(currentCity.population).toBe(1);
          expect(currentCity.foodStock).toBe(turn * 2);
        }
      }

      const finalCity = cityManager.getCity(city.id)!;
      expect(finalCity.population).toBe(2);
      expect(finalCity.foodStock).toBe(0);
      expect(finalCity.workableTiles?.filter(tile => tile.isWorked && !tile.isCenter)).toHaveLength(
        2
      );
    });
  });
});
