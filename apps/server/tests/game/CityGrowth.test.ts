import { CityManager } from '@game/managers/CityManager';
import { EffectsManager } from '@game/managers/EffectsManager';
import { MapManager } from '@game/managers/MapManager';
import { createMockDatabaseProvider } from '../utils/mockDatabaseProvider';

describe('City Population Growth', () => {
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

  describe('Growth Logic Unit Tests (Direct Method Testing)', () => {
    it('should grow population when city has positive food surplus', async () => {
      const city = await cityManager.foundCity(10, 10, 'GrowthCity', 'player-123');

      // Verify initial state
      expect(city.population).toBe(1);
      expect(city.foodStock).toBe(0);

      // Verify granary size calculation
      const granarySize = cityManager.calculateGranarySize(1);
      expect(granarySize).toBe(20); // Standard freeciv value for population 1

      // Set up city with good food surplus: 3 food per turn
      city.foodPerTurn = 3; // This gives +1 surplus after 2 food consumption
      city.foodStock = 19; // One turn away from growth

      // Call processFoodAndGrowth directly to test the core logic
      await cityManager['processFoodAndGrowth'](city, 1);

      // Should grow immediately because:
      // newFoodStock = 19 + 3 = 22 >= granarySize (20)
      // AND foodSurplus (3) > 0
      expect(city.population).toBe(2);
      expect(city.size).toBe(2);
      // C2C3's base Growth_Food effect retains half of the full granary.
      expect(city.foodStock).toBe(12); // 22 - 20 + (20 * 50%)
    });

    it('should not grow when city has zero food surplus', async () => {
      const city = await cityManager.foundCity(15, 15, 'StagnantCity', 'player-123');

      // Set up city with zero net food surplus
      city.foodPerTurn = 0; // No net surplus after consumption
      city.foodStock = 19; // Almost full granary

      // Process one turn
      await cityManager['processFoodAndGrowth'](city, 1);

      // Should not grow because foodSurplus (0) is not > 0
      // newFoodStock = 19 + 0 = 19, but foodSurplus (0) is not > 0
      expect(city.population).toBe(1);
      expect(city.foodStock).toBe(19); // No change
    });

    it('should lose population when city starves', async () => {
      const city = await cityManager.foundCity(20, 20, 'StarvingCity', 'player-123');

      // Start with population 2 for more dramatic effect
      city.population = 2;
      city.size = 2;
      city.foodStock = 5; // Some food in stock

      // Set up starvation: population 2 needs 4 food, city only produces 2
      city.foodPerTurn = -2; // Net deficit of 2 food per turn

      // Process food and growth directly to test starvation logic
      // Turn 1: foodStock = 5 + (-2) = 3
      await cityManager['processFoodAndGrowth'](city, 1);
      expect(city.population).toBe(2);
      expect(city.foodStock).toBe(3);

      // Turn 2: foodStock = 3 + (-2) = 1
      await cityManager['processFoodAndGrowth'](city, 2);
      expect(city.population).toBe(2);
      expect(city.foodStock).toBe(1);

      // Turn 3: foodStock = 1 + (-2) = -1, should trigger starvation
      await cityManager['processFoodAndGrowth'](city, 3);
      expect(city.population).toBe(1);
      expect(city.size).toBe(1);
      expect(city.foodStock).toBe(10); // C2C3 retains half the new size-one granary.
    });

    it('should grow faster with more productive tiles', async () => {
      const city = await cityManager.foundCity(25, 25, 'ProductiveCity', 'player-123');

      // Simulate a city with very productive tiles
      // City center (1) + 2 grassland tiles (2+2) = 5 food total
      // 5 food - 2 consumption = +3 surplus per turn
      city.foodPerTurn = 3;

      // Should grow in 20/3 ≈ 7 turns (ceiling)
      // Process food and growth directly to test the math
      for (let turn = 1; turn <= 7; turn++) {
        await cityManager['processFoodAndGrowth'](city, turn);

        if (turn < 7) {
          expect(city.population).toBe(1);
          expect(city.foodStock).toBe(turn * 3); // Should accumulate 3 food per turn
        } else {
          expect(city.population).toBe(2);
          expect(city.foodStock).toBe(11); // 21 - 20 + (20 * 50%)
        }
      }
    });

    it('should handle growth with marginal food surplus', async () => {
      const city = await cityManager.foundCity(30, 30, 'MarginalCity', 'player-123');

      // Minimal surplus: just enough to grow slowly
      // Population 1 needs 2 food, city produces 2.1 food = +0.1 surplus
      // This tests fractional food handling
      city.foodPerTurn = 0.1;

      // Should eventually grow but take 200 turns
      // Let's test first 50 turns to ensure no premature growth
      for (let turn = 1; turn <= 50; turn++) {
        await cityManager['processFoodAndGrowth'](city, turn);

        // Should still be growing slowly
        expect(city.population).toBe(1);
        expect(city.foodStock).toBeCloseTo(turn * 0.1, 1);
      }
    });

    it('should handle growth exactly at granary threshold', async () => {
      const city = await cityManager.foundCity(45, 45, 'ThresholdCity', 'player-123');

      // Set up to reach exactly 20 food stock
      city.foodPerTurn = 1;
      city.foodStock = 19; // One away from threshold

      // Process one turn
      await cityManager['processFoodAndGrowth'](city, 1);

      // Should grow because foodStock (20) >= granarySize (20) AND foodSurplus (1) > 0
      expect(city.population).toBe(2);
      expect(city.foodStock).toBe(10); // C2C3 retains half the full granary.
    });

    it('should not grow with zero food surplus even with full granary', async () => {
      const city = await cityManager.foundCity(50, 50, 'ZeroSurplusCity', 'player-123');

      // Set up full granary but zero surplus
      city.foodPerTurn = 0; // No surplus
      city.foodStock = 20; // Full granary

      // Call growth logic directly
      await cityManager['processFoodAndGrowth'](city, 1);

      // Should NOT grow because foodSurplus (0) is not > 0
      expect(city.population).toBe(1);
      expect(city.foodStock).toBe(20); // Should remain unchanged
    });

    it('applies C2C3 Aqueduct Size_Adj and Sewer System Size_Unlimit effects', async () => {
      const city = await cityManager.foundCity(55, 45, 'GatedCity', 'player-123');
      city.population = 8;
      city.size = 8;
      city.foodPerTurn = 2;
      city.foodStock = cityManager.calculateGranarySize(8);

      await cityManager['processFoodAndGrowth'](city, 1);
      expect(city.population).toBe(8);

      city.buildings.push('aqueduct');
      await cityManager['processFoodAndGrowth'](city, 2);
      expect(city.population).toBe(9);

      city.population = 16;
      city.size = 16;
      city.foodStock = cityManager.calculateGranarySize(16);
      await cityManager['processFoodAndGrowth'](city, 3);
      expect(city.population).toBe(16);

      city.buildings.push('sewer_system');
      await cityManager['processFoodAndGrowth'](city, 4);
      expect(city.population).toBe(17);
    });

    it('does not rapture-grow a celebrating Republic city without a C2C3 Rapture_Grow effect', async () => {
      cityManager.setPlayerGovernmentProvider(() => 'republic');
      const city = await cityManager.foundCity(60, 45, 'RaptureCity', 'player-123');
      city.population = 3;
      city.size = 3;
      city.foodPerTurn = 1;
      city.foodStock = 0;
      city.happiness = { happy: 2, content: 1, unhappy: 0, angry: 0 };
      city.wasHappy = true;

      await cityManager['processFoodAndGrowth'](city, 1);

      expect(city.population).toBe(3);
      expect(city.foodStock).toBe(1);
    });
  });
});
