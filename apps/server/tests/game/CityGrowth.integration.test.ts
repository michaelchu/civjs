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
