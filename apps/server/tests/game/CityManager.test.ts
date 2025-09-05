import { CityManager, BUILDING_TYPES } from '@game/managers/CityManager';
import { createMockDatabaseProvider } from '../utils/mockDatabaseProvider';

describe('CityManager', () => {
  let cityManager: CityManager;
  const gameId = 'test-game-id';

  beforeEach(() => {
    const mockDbProvider = createMockDatabaseProvider();
    cityManager = new CityManager(gameId, mockDbProvider);
    jest.clearAllMocks();
  });

  describe('building types', () => {
    it('should have valid building type definitions', () => {
      expect(BUILDING_TYPES.palace).toBeDefined();
      expect(BUILDING_TYPES.palace.name).toBe('Palace');
      expect(BUILDING_TYPES.palace.cost).toBe(100);
      expect(BUILDING_TYPES.palace.effects.defenseBonus).toBe(100);

      expect(BUILDING_TYPES.library).toBeDefined();
      expect(BUILDING_TYPES.library.name).toBe('Library');
      expect(BUILDING_TYPES.library.effects.scienceBonus).toBe(50);

      expect(BUILDING_TYPES.granary).toBeDefined();
      expect(BUILDING_TYPES.granary.effects.foodBonus).toBe(50);
    });
  });

  describe('city founding', () => {
    it('should found a city successfully', async () => {
      const cityId = await cityManager.foundCity('player-123', 'TestCity', 10, 10, 1);

      // Should return a generated city ID
      expect(cityId).toBeDefined();
      expect(typeof cityId).toBe('string');

      const city = cityManager.getCity(cityId);
      expect(city).toBeDefined();
      expect(city!.name).toBe('TestCity');
      expect(city!.population).toBe(1);
    });
  });

  describe('city refresh', () => {
    let cityId: string;

    beforeEach(async () => {
      cityId = await cityManager.foundCity('player-123', 'TestCity', 10, 10, 1);
    });

    it('should calculate basic city outputs', () => {
      cityManager.refreshCity(cityId);

      const city = cityManager.getCity(cityId);
      expect(city).toBeDefined();

      // City center gives 2 food, 1 shield, 1 trade
      // Population of 1 eats 2 food
      expect(city!.foodPerTurn).toBe(0); // 2 food - 2 upkeep = 0
      expect(city!.productionPerTurn).toBe(1); // 1 shield
      expect(city!.sciencePerTurn).toBe(1); // 1 trade -> science
      expect(city!.goldPerTurn).toBe(1); // 1 trade -> gold
    });

    it('should apply building bonuses correctly', () => {
      const city = cityManager.getCity(cityId)!;
      city.buildings.push('library'); // +50% science
      city.buildings.push('marketplace'); // +50% gold

      cityManager.refreshCity(cityId);

      expect(city.sciencePerTurn).toBe(1); // Math.floor(1 * 150/100) = 1
      expect(city.goldPerTurn).toBe(1); // Math.floor(1 * 150/100) = 1
      expect(city.happinessLevel).toBe(50); // No happiness buildings
    });

    it('should calculate defense bonuses', () => {
      const city = cityManager.getCity(cityId)!;
      city.buildings.push('walls'); // +200% defense
      city.buildings.push('barracks'); // +50% defense

      cityManager.refreshCity(cityId);

      expect(city.defenseStrength).toBe(3); // 1 base * (100% + 200% + 50%) / 100 = 3.5 -> floor = 3
    });
  });

  describe('production management', () => {
    let cityId: string;

    beforeEach(async () => {
      cityId = await cityManager.foundCity('player-123', 'TestCity', 10, 10, 1);
    });

    it('should set unit production successfully', async () => {
      await cityManager.setCityProduction(cityId, 'warrior', 'unit');

      const city = cityManager.getCity(cityId)!;
      expect(city.currentProduction).toBe('warrior');
      expect(city.productionType).toBe('unit');
      expect(city.turnsToComplete).toBeGreaterThan(0);
    });

    it('should set building production successfully', async () => {
      await cityManager.setCityProduction(cityId, 'granary', 'building');

      const city = cityManager.getCity(cityId)!;
      expect(city.currentProduction).toBe('granary');
      expect(city.productionType).toBe('building');
      expect(city.turnsToComplete).toBe(60); // Granary costs 60, production 1 per turn
    });

    it('should reject invalid unit type', async () => {
      await expect(cityManager.setCityProduction(cityId, 'invalid-unit', 'unit')).rejects.toThrow(
        'Unknown unit type: invalid-unit'
      );
    });

    it('should reject invalid building type', async () => {
      await expect(
        cityManager.setCityProduction(cityId, 'invalid-building', 'building')
      ).rejects.toThrow('Unknown building type: invalid-building');
    });
  });

  // City growth is handled by the turn system
  // Individual growth methods are not exposed in the public API

  describe('utility functions', () => {
    it('should cleanup cities correctly', async () => {
      const cityId = await cityManager.foundCity('player-123', 'TestCity', 10, 10, 1);
      expect(cityManager.getCity(cityId)).toBeDefined();

      cityManager.cleanup();
      expect(cityManager.getCity(cityId)).toBeUndefined();
    });

    it('should provide debug information', async () => {
      await cityManager.foundCity('player-123', 'TestCity', 10, 10, 1);

      const debugInfo = cityManager.getDebugInfo();
      expect(debugInfo).toEqual({
        gameId: gameId,
        cityCount: 1,
        cities: expect.arrayContaining([
          expect.objectContaining({
            name: 'TestCity',
            population: 1,
          }),
        ]),
      });
    });
  });
});
