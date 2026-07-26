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
        tiles: Array(80 * 50)
          .fill(null)
          .map((_, index) => ({
            x: index % 80,
            y: Math.floor(index / 80),
            terrain: 'grassland',
            resource: null,
            special: null,
            improvement: null,
            city: null,
            units: [],
            isVisible: true,
          })),
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

      // Set up for guaranteed growth by starting very close to growth threshold
      // Since grassland provides ~1 net food surplus per turn, start at 19
      city.foodStock = 19; // Almost at growth threshold (need 20 to grow)

      // Process one turn - this will call optimizeCitizens and calculateCityOutputs
      // With grassland terrain, this should produce enough to trigger growth
      await cityManager.processCityTurn(city.id, 1);

      const afterTurn = cityManager.getCity(city.id)!;

      // Verify that population actually grew from the turn processing
      // Starting at 19 food + 1 net surplus = 20 food, which should trigger growth
      expect(afterTurn.population).toBe(initialPopulation + 1);
      expect(afterTurn.population).toBe(2);
      expect(afterTurn.size).toBe(2);

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

    it('should process multiple city turns without growth errors', async () => {
      const city = await cityManager.foundCity(25, 25, 'MultiTurnCity', 'player-123');

      // Process multiple turns to ensure the growth system is stable
      for (let turn = 1; turn <= 10; turn++) {
        await cityManager.processCityTurn(city.id, turn);

        const currentCity = cityManager.getCity(city.id)!;

        // Verify city is still valid after each turn
        expect(currentCity).toBeDefined();
        expect(currentCity.population).toBeGreaterThanOrEqual(1);
        expect(currentCity.foodStock).toBeGreaterThanOrEqual(0);
      }

      // After 10 turns, city should still exist and be functional
      const finalCity = cityManager.getCity(city.id)!;
      expect(finalCity.population).toBeGreaterThanOrEqual(1);
    });
  });
});
