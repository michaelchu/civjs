import { CityManager } from '../../src/game/CityManager';
import { UnitManager } from '../../src/game/UnitManager';

// Get the mock from setup
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const { db: mockDb } = require('../../src/database');

describe('Database Persistence Integration', () => {
  const gameId = 'persistence-test-game';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('city persistence', () => {
    it('should persist city data correctly through full lifecycle', async () => {
      const cityManager = new CityManager(gameId);

      // Setup database mock to return realistic data
      let insertCallCount = 0;
      let updateCallCount = 0;

      mockDb.insert = jest.fn().mockReturnThis();
      mockDb.values = jest.fn().mockImplementation(values => {
        // Verify the data being inserted is complete
        expect(values).toMatchObject({
          gameId,
          playerId: expect.any(String),
          name: expect.any(String),
          x: expect.any(Number),
          y: expect.any(Number),
          population: expect.any(Number),
          food: expect.any(Number),
          foundedTurn: expect.any(Number),
        });
        return mockDb;
      });
      mockDb.returning = jest.fn().mockImplementation(() => {
        insertCallCount++;
        return Promise.resolve([
          {
            id: `city-${insertCallCount}`,
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
      mockDb.set = jest.fn().mockImplementation(data => {
        updateCallCount++;
        // Verify update data structure
        expect(data).toMatchObject({
          population: expect.any(Number),
          food: expect.any(Number),
          foodPerTurn: expect.any(Number),
          production: expect.any(Number),
          productionPerTurn: expect.any(Number),
        });
        return mockDb;
      });
      mockDb.where = jest.fn().mockReturnThis();

      // Test city creation persistence
      const cityId = await cityManager.foundCity('player-123', 'TestCity', 10, 10, 1);

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalled();
      expect(mockDb.returning).toHaveBeenCalled();

      // Test city update persistence
      await cityManager.processCityTurn(cityId, 2);

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalled();
      expect(updateCallCount).toBe(1);
    });

    it('should handle database load operations correctly', async () => {
      const cityManager = new CityManager(gameId);

      const mockCityData = [
        {
          id: 'loaded-city-1',
          gameId,
          playerId: 'player-456',
          name: 'LoadedCity',
          x: 15,
          y: 15,
          population: 3,
          food: 25,
          foodPerTurn: 4,
          production: 10,
          productionPerTurn: 3,
          currentProduction: 'warrior',
          goldPerTurn: 5,
          sciencePerTurn: 3,
          culturePerTurn: 2,
          buildings: ['granary', 'barracks'],
          workedTiles: [
            { x: 15, y: 15 },
            { x: 16, y: 15 },
            { x: 14, y: 15 },
          ],
          isCapital: true,
          defenseStrength: 4,
          happiness: 70,
          health: 100,
          foundedTurn: 5,
        },
      ];

      mockDb.select = jest.fn().mockReturnThis();
      mockDb.from = jest.fn().mockReturnThis();
      mockDb.where = jest.fn().mockResolvedValue(mockCityData);

      await cityManager.loadCities();

      // Verify correct database query
      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.from).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();

      // Verify data was loaded correctly
      const loadedCity = cityManager.getCity('loaded-city-1');
      expect(loadedCity).toBeDefined();
      expect(loadedCity!.name).toBe('LoadedCity');
      expect(loadedCity!.population).toBe(3);
      expect(loadedCity!.buildings).toEqual(['granary', 'barracks']);
      expect(loadedCity!.workingTiles).toHaveLength(3);
    });
  });

  describe('unit persistence', () => {
    it('should persist unit operations with proper data validation', async () => {
      const unitManager = new UnitManager(gameId, 50, 50);

      const insertedUnits: any[] = [];

      mockDb.insert = jest.fn().mockReturnThis();
      mockDb.values = jest.fn().mockImplementation(values => {
        // Validate inserted unit data
        expect(values).toMatchObject({
          gameId,
          playerId: expect.any(String),
          unitType: expect.any(String),
          x: expect.any(Number),
          y: expect.any(Number),
          health: 100,
          veteranLevel: 0,
        });

        insertedUnits.push(values);
        return mockDb;
      });

      mockDb.returning = jest.fn().mockImplementation(() => {
        const unitData = insertedUnits[insertedUnits.length - 1];
        return Promise.resolve([
          {
            id: `unit-${insertedUnits.length}`,
            ...unitData,
            movementPoints: '2',
          },
        ]);
      });

      mockDb.update = jest.fn().mockReturnThis();
      mockDb.set = jest.fn().mockReturnThis();
      mockDb.where = jest.fn().mockReturnThis();

      // Test unit creation with various types
      const warrior = await unitManager.createUnit('player-1', 'warrior', 10, 10);
      await unitManager.createUnit('player-1', 'settler', 15, 15);

      expect(insertedUnits).toHaveLength(2);
      expect(insertedUnits[0].unitType).toBe('warrior');
      expect(insertedUnits[1].unitType).toBe('settler');

      // Test unit movement persistence
      await unitManager.moveUnit(warrior.id, 11, 10);

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          x: 11,
          y: 10,
          movementPoints: expect.any(String),
        })
      );
    });
  });
});
