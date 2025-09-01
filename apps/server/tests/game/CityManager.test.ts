import { CityManager, BUILDING_TYPES } from '../../src/game/CityManager';
import { UNIT_TYPES } from '../../src/game/constants/UnitConstants';

// Get the mock from setup
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const { db: mockDb } = require('../../src/database');

describe('CityManager', () => {
  let cityManager: CityManager;
  const gameId = 'test-game-id';

  beforeEach(() => {
    cityManager = new CityManager(gameId);

    let cityCounter = 0;

    // Mock database operations
    mockDb.insert = jest.fn().mockReturnThis();
    mockDb.values = jest.fn().mockReturnThis();
    mockDb.returning = jest.fn().mockImplementation(() => {
      const cityId = `city-${++cityCounter}`;
      return Promise.resolve([
        {
          id: cityId,
          gameId,
          playerId: 'player-123',
          name: 'TestCity',
          x: 10,
          y: 10,
          population: 1,
          food: 0,
          foodPerTurn: 2,
          production: 0,
          productionPerTurn: 1,
          currentProduction: null,
          goldPerTurn: 0,
          sciencePerTurn: 0,
          culturePerTurn: 1,
          buildings: [],
          workedTiles: [{ x: 10, y: 10 }],
          isCapital: false,
          defenseStrength: 1,
          happiness: 50,
          health: 100,
          foundedTurn: 1,
        },
      ]);
    });
    mockDb.update = jest.fn().mockReturnThis();
    mockDb.set = jest.fn().mockReturnThis();
    mockDb.where = jest.fn().mockReturnThis();
    mockDb.select = jest.fn().mockReturnThis();
    mockDb.from = jest.fn().mockReturnThis();

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
      expect(BUILDING_TYPES.granary.effects.foodBonus).toBe(1);
    });
  });

  describe('city founding', () => {
    it('should found a city successfully', async () => {
      const cityId = await cityManager.foundCity('player-123', 'TestCity', 10, 10, 1);

      expect(cityId).toBe('city-1');
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          gameId,
          playerId: 'player-123',
          name: 'TestCity',
          x: 10,
          y: 10,
          population: 1,
          food: 0,
          foodPerTurn: 2,
          production: 0,
          productionPerTurn: 1,
          isCapital: false,
          defenseStrength: 1,
          foundedTurn: 1,
        })
      );

      const city = cityManager.getCity(cityId);
      expect(city).toBeDefined();
      expect(city!.name).toBe('TestCity');
      expect(city!.population).toBe(1);
      expect(city!.foodPerTurn).toBe(2);
      expect(city!.productionPerTurn).toBe(1);
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
      city.buildings.push('barracks'); // +50% defense
      city.buildings.push('walls'); // +200% defense

      cityManager.refreshCity(cityId);

      expect(city.defenseStrength).toBe(3); // Math.floor(1 * (100 + 50 + 200) / 100) = 3
    });
  });

  describe('city growth and starvation', () => {
    let cityId: string;

    beforeEach(async () => {
      cityId = await cityManager.foundCity('player-123', 'TestCity', 10, 10, 1);
    });

    it('should grow city when food surplus exists', async () => {
      const city = cityManager.getCity(cityId)!;
      city.foodStock = 20; // Enough for growth (population 2 needs (1+1)*10 = 20 food)
      // Add extra working tiles to generate food surplus
      city.workingTiles = [
        { x: 10, y: 10 }, // City center: 2 food, 1 shield, 1 trade
        { x: 11, y: 10 }, // Extra tile: 1 food, 1 shield, 1 trade
        { x: 9, y: 10 }, // Extra tile: 1 food, 1 shield, 1 trade
      ]; // Total: 4 food - 2 upkeep = 2 food surplus

      await cityManager.processCityTurn(cityId, 2);

      expect(city.population).toBe(2);
      expect(city.foodStock).toBe(0); // Reset after growth
    });

    it('should not grow without food surplus', async () => {
      const city = cityManager.getCity(cityId)!;
      city.foodStock = 5;
      city.foodPerTurn = 0; // No surplus

      await cityManager.processCityTurn(cityId, 2);

      expect(city.population).toBe(1); // No growth
      expect(city.foodStock).toBe(5); // No change
    });

    it('should cause starvation when food is negative', async () => {
      const city = cityManager.getCity(cityId)!;
      city.population = 2;
      city.foodStock = -5;
      city.foodPerTurn = -1; // Starving

      await cityManager.processCityTurn(cityId, 2);

      expect(city.population).toBe(1); // Lost population
      expect(city.foodStock).toBe(0); // Reset after starvation
    });
  });

  describe('production system', () => {
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
      expect(mockDb.update).toHaveBeenCalled();
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

    it('should reject duplicate building', async () => {
      const city = cityManager.getCity(cityId)!;
      city.buildings.push('granary');

      await expect(cityManager.setCityProduction(cityId, 'granary', 'building')).rejects.toThrow(
        'Building already exists: granary'
      );
    });

    it('should accumulate production over turns', async () => {
      await cityManager.setCityProduction(cityId, 'warrior', 'unit');
      const city = cityManager.getCity(cityId)!;

      await cityManager.processCityTurn(cityId, 2);
      expect(city.productionStock).toBe(1);

      await cityManager.processCityTurn(cityId, 3);
      expect(city.productionStock).toBe(2);
    });

    it('should complete unit production', async () => {
      await cityManager.setCityProduction(cityId, 'warrior', 'unit');
      const city = cityManager.getCity(cityId)!;
      city.productionStock = UNIT_TYPES.warrior.cost - 1; // Almost complete

      await cityManager.processCityTurn(cityId, 2);

      expect(city.productionStock).toBe(0); // Reset after completion
      expect(city.currentProduction).toBeUndefined();
      expect(city.productionType).toBeUndefined();
    });

    it('should complete building production', async () => {
      await cityManager.setCityProduction(cityId, 'granary', 'building');
      const city = cityManager.getCity(cityId)!;
      city.productionStock = BUILDING_TYPES.granary.cost - 1; // Almost complete

      await cityManager.processCityTurn(cityId, 2);

      expect(city.buildings).toContain('granary');
      expect(city.productionStock).toBe(0); // Reset after completion
      expect(city.currentProduction).toBeUndefined();
    });
  });

  describe('city queries', () => {
    beforeEach(async () => {
      await cityManager.foundCity('player-123', 'City1', 10, 10, 1);
      await cityManager.foundCity('player-123', 'City2', 20, 20, 1);
      await cityManager.foundCity('player-456', 'City3', 30, 30, 1);
    });

    it('should get player cities', () => {
      const player123Cities = cityManager.getPlayerCities('player-123');
      const player456Cities = cityManager.getPlayerCities('player-456');

      expect(player123Cities).toHaveLength(2);
      expect(player456Cities).toHaveLength(1);

      expect(player123Cities.every(c => c.playerId === 'player-123')).toBe(true);
      expect(player456Cities.every(c => c.playerId === 'player-456')).toBe(true);
    });

    it('should get city at position', () => {
      const city = cityManager.getCityAt(10, 10);
      expect(city).toBeDefined();
      expect(city!.name).toBe('City1');

      const noCity = cityManager.getCityAt(50, 50);
      expect(noCity).toBeUndefined();
    });
  });

  describe('turn processing', () => {
    let cityId: string;

    beforeEach(async () => {
      cityId = await cityManager.foundCity('player-123', 'TestCity', 10, 10, 1);
      await cityManager.foundCity('player-456', 'OtherCity', 20, 20, 1);
    });

    it('should process all cities in a turn', async () => {
      await cityManager.processAllCitiesTurn(2);

      // Verify that database updates were called for both cities
      expect(mockDb.update).toHaveBeenCalledTimes(2);
    });

    it('should update database after processing', async () => {
      const city = cityManager.getCity(cityId)!;
      city.population = 3;
      city.foodStock = 10;

      await cityManager.processCityTurn(cityId, 2);

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          population: expect.any(Number),
          food: expect.any(Number),
          foodPerTurn: expect.any(Number),
          production: expect.any(Number),
          productionPerTurn: expect.any(Number),
        })
      );
    });
  });

  describe('database integration', () => {
    it('should load cities from database', async () => {
      const mockDbCities = [
        {
          id: 'city-1',
          gameId,
          playerId: 'player-1',
          name: 'LoadedCity',
          x: 5,
          y: 5,
          population: 2,
          food: 10,
          foodPerTurn: 3,
          production: 5,
          productionPerTurn: 2,
          currentProduction: 'warrior',
          goldPerTurn: 2,
          sciencePerTurn: 2,
          culturePerTurn: 1,
          buildings: ['granary', 'barracks'],
          workedTiles: [
            { x: 5, y: 5 },
            { x: 6, y: 5 },
          ],
          isCapital: true,
          defenseStrength: 3,
          happiness: 60,
          health: 100,
          foundedTurn: 1,
        },
      ];

      mockDb.select.mockReturnThis();
      mockDb.from.mockReturnThis();
      mockDb.where.mockResolvedValue(mockDbCities);

      await cityManager.loadCities();

      const city = cityManager.getCity('city-1');
      expect(city).toBeDefined();
      expect(city!.name).toBe('LoadedCity');
      expect(city!.population).toBe(2);
      expect(city!.buildings).toEqual(['granary', 'barracks']);
      expect(city!.isCapital).toBe(true);
      expect(city!.workingTiles).toHaveLength(2);
    });

    it('should handle missing or invalid data gracefully', async () => {
      const mockDbCities = [
        {
          id: 'city-1',
          gameId,
          playerId: 'player-1',
          name: 'BrokenCity',
          x: 5,
          y: 5,
          population: 1,
          food: 0,
          foodPerTurn: 2,
          production: 0,
          productionPerTurn: 1,
          currentProduction: null,
          goldPerTurn: 0,
          sciencePerTurn: 0,
          culturePerTurn: 1,
          buildings: null, // Invalid data
          workedTiles: null, // Invalid data
          isCapital: false,
          defenseStrength: 1,
          happiness: 50,
          health: 100,
          foundedTurn: 1,
        },
      ];

      mockDb.select.mockReturnThis();
      mockDb.from.mockReturnThis();
      mockDb.where.mockResolvedValue(mockDbCities);

      await cityManager.loadCities();

      const city = cityManager.getCity('city-1');
      expect(city).toBeDefined();
      expect(city!.buildings).toEqual([]); // Default to empty array
      expect(city!.workingTiles).toEqual([{ x: 5, y: 5 }]); // Default to city center
    });
  });

  describe('cleanup', () => {
    it('should clean up all cities', async () => {
      await cityManager.foundCity('player-123', 'TestCity', 10, 10, 1);
      expect(cityManager.getCity('city-1')).toBeDefined();

      cityManager.cleanup();
      expect(cityManager.getCity('city-1')).toBeUndefined();
    });
  });

  describe('debug information', () => {
    it('should provide debug information', async () => {
      await cityManager.foundCity('player-123', 'TestCity', 10, 10, 1);

      const debugInfo = cityManager.getDebugInfo();

      expect(debugInfo).toEqual({
        gameId,
        cityCount: 1,
        cities: [
          expect.objectContaining({
            id: 'city-1',
            name: 'TestCity',
            population: 1,
            foodPerTurn: expect.any(Number),
            productionPerTurn: expect.any(Number),
          }),
        ],
      });
    });
  });
});
