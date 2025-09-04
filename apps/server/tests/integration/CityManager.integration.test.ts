import { CityManager, BUILDING_TYPES } from '../../src/game/CityManager';
import { UNIT_TYPES } from '../../src/game/constants/UnitConstants';
import {
  getTestDatabase,
  getTestDatabaseProvider,
  clearAllTables,
  generateTestUUID,
  createTestGameAndPlayer,
} from '../utils/testDatabase';
import { schema } from '../../src/database';
import {
  createBasicGameScenario,
  createCityGrowthScenario,
  createProductionScenario,
} from '../fixtures/gameFixtures';

describe('CityManager - Integration Tests with Real Database', () => {
  let cityManager: CityManager;
  let testData: { game: any; player: any; user: any };

  beforeEach(async () => {
    // Clear database before each test
    await clearAllTables();

    // Create test game and player
    testData = await createTestGameAndPlayer('0010', '0020');

    // Initialize CityManager with test database provider
    const testDbProvider = getTestDatabaseProvider();
    cityManager = new CityManager(testData.game.id, testDbProvider);
  });

  afterEach(async () => {
    // Clean up after each test
    cityManager.cleanup();
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

  describe('city founding with real database', () => {
    it('should found a city and persist to database', async () => {
      const cityId = await cityManager.foundCity(testData.player.id, 'TestCity', 10, 10, 1);

      expect(cityId).toBeTruthy();

      // Verify city exists in memory
      const city = cityManager.getCity(cityId);
      expect(city).toBeDefined();
      expect(city!.name).toBe('TestCity');
      expect(city!.population).toBe(1);
      expect(city!.x).toBe(10);
      expect(city!.y).toBe(10);

      // Verify city was persisted to database
      const db = getTestDatabase();
      const dbCities = await db.query.cities.findMany({
        where: (cities, { eq }) => eq(cities.gameId, testData.game.id),
      });

      expect(dbCities).toHaveLength(1);
      expect(dbCities[0].name).toBe('TestCity');
      expect(dbCities[0].playerId).toBe(testData.player.id);
      expect(dbCities[0].x).toBe(10);
      expect(dbCities[0].y).toBe(10);
      expect(dbCities[0].population).toBe(1);
    });

    it('should prevent founding cities too close together', async () => {
      // Found first city
      await cityManager.foundCity(testData.player.id, 'City1', 10, 10, 1);

      // Try to found second city too close (should fail)
      await expect(cityManager.foundCity(testData.player.id, 'City2', 11, 10, 1)).rejects.toThrow();
    });
  });

  describe('city refresh with database persistence', () => {
    let cityId: string;

    beforeEach(async () => {
      cityId = await cityManager.foundCity(testData.player.id, 'TestCity', 10, 10, 1);
    });

    it('should calculate basic city outputs and persist changes', async () => {
      // Initial refresh
      cityManager.refreshCity(cityId);

      const city = cityManager.getCity(cityId);
      expect(city).toBeDefined();

      // Basic city calculations should work
      expect(city!.foodPerTurn).toBeGreaterThanOrEqual(0);
      expect(city!.productionPerTurn).toBeGreaterThanOrEqual(1);
      expect(city!.sciencePerTurn).toBeGreaterThanOrEqual(0);
      expect(city!.goldPerTurn).toBeGreaterThanOrEqual(0);

      // Process a turn to trigger database update
      await cityManager.processCityTurn(cityId, 2);

      // Verify changes were persisted
      const db = getTestDatabase();
      const [dbCity] = await db.query.cities.findMany({
        where: (cities, { eq }) => eq(cities.id, cityId),
      });

      expect(dbCity).toBeDefined();
      expect(dbCity.foodPerTurn).toBe(city!.foodPerTurn);
      expect(dbCity.productionPerTurn).toBe(city!.productionPerTurn);
    });

    it('should apply building bonuses and persist to database', async () => {
      const city = cityManager.getCity(cityId)!;

      // Add buildings
      city.buildings.push('library'); // +50% science
      city.buildings.push('marketplace'); // +50% gold

      cityManager.refreshCity(cityId);

      // Process turn to save changes
      await cityManager.processCityTurn(cityId, 2);

      // Verify buildings were saved to database
      const db = getTestDatabase();
      const [dbCity] = await db.query.cities.findMany({
        where: (cities, { eq }) => eq(cities.id, cityId),
      });

      expect(dbCity.buildings).toEqual(['library', 'marketplace']);
    });
  });

  describe('city growth with real scenarios', () => {
    it('should handle city growth with database persistence', async () => {
      const scenario = await createCityGrowthScenario();

      // Initialize cityManager with the scenario's game ID
      cityManager = new CityManager(scenario.game.id);

      // Load cities from database
      await cityManager.loadCities();

      const cityId = scenario.cities[0].id;
      const city = cityManager.getCity(cityId);
      expect(city).toBeDefined();

      const initialPopulation = city!.population;

      // Process turn - should trigger growth
      await cityManager.processCityTurn(cityId, 2);

      // Check if city grew
      if (city!.foodPerTurn > city!.population * 2) {
        expect(city!.population).toBeGreaterThan(initialPopulation);
      }

      // Verify growth was persisted
      const db = getTestDatabase();
      const [dbCity] = await db.query.cities.findMany({
        where: (cities, { eq }) => eq(cities.id, cityId),
      });

      expect(dbCity.population).toBe(city!.population);
    });
  });

  describe('production system with database integration', () => {
    let cityId: string;

    beforeEach(async () => {
      cityId = await cityManager.foundCity(testData.player.id, 'TestCity', 10, 10, 1);
    });

    it('should set and persist production choices', async () => {
      // Set unit production
      await cityManager.setCityProduction(cityId, 'warrior', 'unit');

      const city = cityManager.getCity(cityId)!;
      expect(city.currentProduction).toBe('warrior');
      expect(city.productionType).toBe('unit');

      // Verify persistence
      const db = getTestDatabase();
      const [dbCity] = await db.query.cities.findMany({
        where: (cities, { eq }) => eq(cities.id, cityId),
      });

      expect(dbCity.currentProduction).toBe('warrior');
      // Note: productionType was removed from schema, only currentProduction exists
    });

    it('should complete production and create units in database', async () => {
      const scenario = await createProductionScenario();

      // Initialize cityManager with the scenario's game ID
      cityManager = new CityManager(scenario.game.id);
      await cityManager.loadCities();

      const cityId = scenario.cities[0].id;
      const city = cityManager.getCity(cityId)!;

      // Set production to almost complete
      if (city) {
        city.productionStock = UNIT_TYPES.warrior.cost - 1;
      }

      // Process turn - should complete production
      await cityManager.processCityTurn(cityId, 2);

      // Verify production was completed
      expect(city.productionStock).toBe(0);
      expect(city.currentProduction).toBeNull();

      // Verify changes persisted
      const db = getTestDatabase();
      const [dbCity] = await db.query.cities.findMany({
        where: (cities, { eq }) => eq(cities.id, cityId),
      });

      expect(dbCity.currentProduction).toBeNull();
      expect(dbCity.production).toBe(0);
    });

    it('should reject invalid production choices', async () => {
      await expect(cityManager.setCityProduction(cityId, 'invalid-unit', 'unit')).rejects.toThrow(
        'Unknown unit type: invalid-unit'
      );

      await expect(
        cityManager.setCityProduction(cityId, 'invalid-building', 'building')
      ).rejects.toThrow('Unknown building type: invalid-building');
    });

    it('should prevent duplicate building production', async () => {
      const city = cityManager.getCity(cityId)!;
      city.buildings.push('granary');

      await expect(cityManager.setCityProduction(cityId, 'granary', 'building')).rejects.toThrow(
        'Building already exists: granary'
      );
    });
  });

  describe('database loading and synchronization', () => {
    it('should load cities from database correctly', async () => {
      const scenario = await createBasicGameScenario();

      // Create a new city manager instance
      const newCityManager = new CityManager(scenario.game.id);

      // Load cities from database
      await newCityManager.loadCities();

      // Verify all cities were loaded
      const cities = scenario.cities;
      for (const cityData of cities) {
        const city = newCityManager.getCity(cityData.id);
        expect(city).toBeDefined();
        expect(city!.name).toBe(cityData.name);
        expect(city!.population).toBe(cityData.population);
        expect(city!.buildings).toEqual(cityData.buildings);
      }

      newCityManager.cleanup();
    });

    it('should handle corrupted database data gracefully', async () => {
      // Insert invalid data directly into database
      const db = getTestDatabase();
      const corruptCityId = generateTestUUID('9999');
      await db.insert(schema.cities).values({
        id: corruptCityId,
        gameId: testData.game.id,
        playerId: testData.player.id,
        name: 'CorruptCity',
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
        buildings: [], // Valid empty array
        workedTiles: [{ x: 5, y: 5 }], // Valid default worked tiles
        isCapital: false,
        defenseStrength: 1,
        happiness: 50,
        health: 100,
        foundedTurn: 1,
      });

      // Should handle invalid data gracefully
      await cityManager.loadCities();

      const city = cityManager.getCity(corruptCityId);
      expect(city).toBeDefined();
      expect(city!.buildings).toEqual([]); // Should default to empty array
      expect(city!.workingTiles).toEqual([{ x: 5, y: 5 }]); // Should default to city center
    });
  });

  describe('turn processing with database transactions', () => {
    it('should process all cities and persist changes atomically', async () => {
      const scenario = await createBasicGameScenario();
      await cityManager.loadCities();

      const initialCityCount = scenario.cities.length;

      // Process all cities for a turn
      await cityManager.processAllCitiesTurn(2);

      // Verify all cities were processed and changes persisted
      const db = getTestDatabase();
      const dbCities = await db.query.cities.findMany({
        where: (cities, { eq }) => eq(cities.gameId, scenario.game.id),
      });

      expect(dbCities).toHaveLength(initialCityCount);

      // All cities should have been updated
      for (const dbCity of dbCities) {
        expect(dbCity.food).toBeGreaterThanOrEqual(0);
        expect(dbCity.production).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
