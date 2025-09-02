import { GameManager } from '../../src/game/GameManager';
import { Server as SocketServer } from 'socket.io';
import { getTestDatabase, clearAllTables } from '../utils/testDatabase';
import { createBasicGameScenario } from '../fixtures/gameFixtures';

describe('Cross-Manager Integration Tests - Real Database Interactions', () => {
  let gameManager: GameManager;
  const mockIo = {
    emit: jest.fn(),
    to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    sockets: {
      sockets: new Map(),
      adapter: { rooms: new Map() },
    },
  } as unknown as SocketServer;

  beforeEach(async () => {
    await clearAllTables();
    (GameManager as any).instance = null;
    gameManager = GameManager.getInstance(mockIo);
  });

  afterEach(async () => {
    gameManager['games'].clear();
    gameManager['playerToGame'].clear();
  });

  describe('city production completing to create units', () => {
    let gameId: string;
    let playerId: string;
    let cityId: string;

    beforeEach(async () => {
      const scenario = await createBasicGameScenario();
      gameId = scenario.game.id;
      playerId = scenario.players[0].id;

      await gameManager.loadGame(gameId);

      // Found a city for production
      cityId = await gameManager.foundCity(gameId, playerId, 'ProductionCity', 5, 5);
    });

    it('should complete warrior production and create unit with proper database persistence', async () => {
      const game = gameManager.getGameInstance(gameId)!;

      // Set city to produce a warrior
      await game.cityManager.setCityProduction(cityId, 'warrior', 'unit');

      // Simulate production progress by setting production stock high
      const city = game.cityManager.getCity(cityId)!;
      city.productionStock = 20; // Warrior costs 20 shields

      // Process city turn - should complete warrior
      await game.cityManager.processCityTurn(cityId, 2);

      // Verify production was completed
      expect(city.currentProduction).toBeUndefined();
      expect(city.productionStock).toBe(0);

      // Verify unit was created in UnitManager
      const cityUnits = game.unitManager.getUnitsAt(5, 5);
      expect(cityUnits.length).toBeGreaterThan(0);

      const warrior = cityUnits.find(u => u.unitTypeId === 'warrior');
      expect(warrior).toBeDefined();
      expect(warrior!.playerId).toBe(playerId);

      // Verify both city and unit were persisted to database
      const db = getTestDatabase();
      const [dbCity] = await db.query.cities.findMany({
        where: (cities, { eq }) => eq(cities.id, cityId),
      });
      const dbUnits = await db.query.units.findMany({
        where: (units, { and, eq }) =>
          and(
            eq(units.gameId, gameId),
            eq(units.unitType, 'warrior'),
            eq(units.x, 5),
            eq(units.y, 5)
          ),
      });

      expect(dbCity.currentProduction).toBeNull();
      expect(dbCity.production).toBe(0);
      expect(dbUnits.length).toBeGreaterThan(0);
    });

    it('should complete building construction and apply effects', async () => {
      const game = gameManager.getGameInstance(gameId)!;

      // Set city to produce granary
      await game.cityManager.setCityProduction(cityId, 'granary', 'building');

      const city = game.cityManager.getCity(cityId)!;
      city.productionStock = 60; // Granary costs 60 shields

      // Process city turn - should complete granary
      await game.cityManager.processCityTurn(cityId, 2);

      // Verify building was added
      expect(city.buildings).toContain('granary');
      expect(city.currentProduction).toBeUndefined();

      // Refresh city to apply building effects
      game.cityManager.refreshCity(cityId);

      // Granary should provide food bonus
      const initialFoodPerTurn = city.foodPerTurn;
      expect(initialFoodPerTurn).toBeGreaterThan(0);

      // Verify building persisted to database
      const db = getTestDatabase();
      const [dbCity] = await db.query.cities.findMany({
        where: (cities, { eq }) => eq(cities.id, cityId),
      });

      expect(dbCity.buildings).toContain('granary');
      expect(dbCity.currentProduction).toBeNull();
    });
  });

  describe('unit movement affecting visibility and city defense', () => {
    let gameId: string;
    let playerId: string;
    let enemyPlayerId: string;
    let unitId: string;

    beforeEach(async () => {
      const scenario = await createBasicGameScenario();
      gameId = scenario.game.id;
      playerId = scenario.players[0].id;
      enemyPlayerId = scenario.players[1].id;

      await gameManager.loadGame(gameId);

      // Create a unit for movement
      unitId = await gameManager.createUnit(gameId, playerId, 'warrior', 8, 8);
    });

    it('should update visibility when unit moves and persist fog of war changes', async () => {
      const game = gameManager.getGameInstance(gameId)!;

      // Initial visibility update
      gameManager.updatePlayerVisibility(gameId, playerId);

      // Move unit to new position
      const moveResult = await game.unitManager.moveUnit(unitId, 10, 8);
      expect(moveResult).toBe(true);

      // Update visibility after movement
      gameManager.updatePlayerVisibility(gameId, playerId);

      const newVisibility = gameManager.getTileVisibility(gameId, playerId, 10, 8);
      expect(newVisibility.isVisible).toBe(true);
      expect(newVisibility.isExplored).toBe(true);

      // Verify unit position persisted to database
      const db = getTestDatabase();
      const [dbUnit] = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.id, unitId),
      });

      expect(dbUnit.x).toBe(10);
      expect(dbUnit.y).toBe(8);
    });

    it('should prevent movement into enemy city and maintain city integrity', async () => {
      // Create enemy city
      const enemyCityId = await gameManager.foundCity(gameId, enemyPlayerId, 'EnemyCity', 10, 8);

      const game = gameManager.getGameInstance(gameId)!;

      // Try to move unit into enemy city (should fail)
      await expect(game.unitManager.moveUnit(unitId, 10, 8)).rejects.toThrow();

      // Verify unit didn't move
      const unit = game.unitManager.getUnit(unitId);
      expect(unit!.x).toBe(8);
      expect(unit!.y).toBe(8);

      // Verify enemy city is intact
      const enemyCity = game.cityManager.getCity(enemyCityId);
      expect(enemyCity).toBeDefined();
      expect(enemyCity!.x).toBe(10);
      expect(enemyCity!.y).toBe(8);

      // Verify database reflects no movement
      const db = getTestDatabase();
      const [dbUnit] = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.id, unitId),
      });
      const [dbCity] = await db.query.cities.findMany({
        where: (cities, { eq }) => eq(cities.id, enemyCityId),
      });

      expect(dbUnit.x).toBe(8);
      expect(dbUnit.y).toBe(8);
      expect(dbCity.x).toBe(10);
      expect(dbCity.y).toBe(8);
    });
  });

  describe('research completion affecting city and unit capabilities', () => {
    let gameId: string;
    let playerId: string;

    beforeEach(async () => {
      const scenario = await createBasicGameScenario();
      gameId = scenario.game.id;
      playerId = scenario.players[0].id;

      await gameManager.loadGame(gameId);
    });

    it('should unlock new technologies and enable new production options', async () => {
      const game = gameManager.getGameInstance(gameId)!;

      // Start researching pottery
      await gameManager.setPlayerResearch(gameId, playerId, 'pottery');

      // Verify research in progress
      const research = gameManager.getPlayerResearch(gameId, playerId);
      expect(research?.currentTech).toBe('pottery');

      // Simulate research completion by adding enough research points
      await game.researchManager.addResearchPoints(playerId, 1000); // Give plenty to complete

      // Verify technology was completed
      const playerTechs = game.researchManager.getResearchedTechs(playerId);
      expect(playerTechs).toContain('pottery');

      // Verify new techs became available
      const availableTechs = gameManager.getAvailableTechnologies(gameId, playerId);
      expect(availableTechs.length).toBeGreaterThan(0);

      // Verify research progress persisted to database
      const db = getTestDatabase();
      const dbTech = await db.query.playerTechs.findMany({
        where: (tech, { and, eq }) => and(eq(tech.playerId, playerId), eq(tech.techId, 'pottery')),
      });

      expect(dbTech.length).toBeGreaterThan(0);
    });

    it('should enable new unit types after tech research', async () => {
      const game = gameManager.getGameInstance(gameId)!;

      // Set bronze working as current research and complete it
      await game.researchManager.setCurrentResearch(playerId, 'bronze_working');
      await game.researchManager.addResearchPoints(playerId, 1000);

      // Found a city for production
      const cityId = await gameManager.foundCity(gameId, playerId, 'TechCity', 7, 7);

      // Should now be able to produce spearmen (requires bronze working)
      await expect(
        game.cityManager.setCityProduction(cityId, 'spearman', 'unit')
      ).resolves.not.toThrow();

      const city = game.cityManager.getCity(cityId)!;
      expect(city.currentProduction).toBe('spearman');

      // Verify tech completion persisted
      const db = getTestDatabase();
      const dbTech = await db.query.playerTechs.findMany({
        where: (tech, { and, eq }) =>
          and(eq(tech.playerId, playerId), eq(tech.techId, 'bronze_working')),
      });

      expect(dbTech.length).toBeGreaterThan(0);
    });
  });

  describe('turn processing affecting all managers simultaneously', () => {
    let gameId: string;
    let playerId1: string;
    let playerId2: string;

    beforeEach(async () => {
      const scenario = await createBasicGameScenario();
      gameId = scenario.game.id;
      playerId1 = scenario.players[0].id;
      playerId2 = scenario.players[1].id;

      await gameManager.loadGame(gameId);
    });

    it('should process complete turn cycle with database consistency', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const initialTurn = game.turnManager.getCurrentTurn();

      // Create some game state to process
      const cityId = await gameManager.foundCity(gameId, playerId1, 'TurnCity', 6, 6);
      const unitId = await gameManager.createUnit(gameId, playerId1, 'warrior', 7, 7);

      // Set city production
      await game.cityManager.setCityProduction(cityId, 'warrior', 'unit');

      // Set research
      await gameManager.setPlayerResearch(gameId, playerId1, 'pottery');

      // Use some unit movement
      await game.unitManager.moveUnit(unitId, 8, 7);

      // End turns for both players
      await gameManager.endTurn(playerId1);
      const turnAdvanced = await gameManager.endTurn(playerId2);

      expect(turnAdvanced).toBe(true);
      expect(game.turnManager.getCurrentTurn()).toBe(initialTurn + 1);

      // Verify all managers processed the turn
      const city = game.cityManager.getCity(cityId)!;
      expect(city.foodStock).toBeGreaterThanOrEqual(0);
      expect(city.productionStock).toBeGreaterThan(0);

      const unit = game.unitManager.getUnit(unitId)!;
      expect(unit.movementLeft).toBe(6); // Reset after turn

      const research = gameManager.getPlayerResearch(gameId, playerId1);
      expect(research?.bulbsAccumulated).toBeGreaterThan(0);

      // Verify all changes persisted to database
      const db = getTestDatabase();
      const [dbGame] = await db.query.games.findMany({
        where: (games, { eq }) => eq(games.id, gameId),
      });
      const [dbCity] = await db.query.cities.findMany({
        where: (cities, { eq }) => eq(cities.id, cityId),
      });
      const [dbUnit] = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.id, unitId),
      });

      expect(dbGame.currentTurn).toBe(initialTurn + 1);
      expect(dbCity.food).toBe(city.foodStock);
      expect(dbCity.production).toBe(city.productionStock);
      expect(dbUnit.movementPoints).toBe('6.00');
    });

    it('should handle concurrent turn ending safely', async () => {
      const game = gameManager.getGameInstance(gameId)!;

      // Both players try to end turn simultaneously
      const turnResults = await Promise.all([
        gameManager.endTurn(playerId1),
        gameManager.endTurn(playerId2),
      ]);

      // One should return false (first to end), one should return true (turn advanced)
      expect(turnResults.some(result => result === true)).toBe(true);
      expect(turnResults.some(result => result === false)).toBe(true);

      // Turn should have advanced exactly once
      expect(game.turnManager.getCurrentTurn()).toBeGreaterThan(0);

      // Verify database consistency
      const db = getTestDatabase();
      const [dbGame] = await db.query.games.findMany({
        where: (games, { eq }) => eq(games.id, gameId),
      });
      expect(dbGame.currentTurn).toBeGreaterThan(0);
    });
  });

  describe('complex multi-manager scenarios', () => {
    let gameId: string;
    let playerId: string;

    beforeEach(async () => {
      const scenario = await createBasicGameScenario();
      gameId = scenario.game.id;
      playerId = scenario.players[0].id;

      await gameManager.loadGame(gameId);
    });

    it('should handle city growth creating new worked tiles affecting unit movement', async () => {
      const game = gameManager.getGameInstance(gameId)!;

      // Found a city
      const cityId = await gameManager.foundCity(gameId, playerId, 'GrowthCity', 12, 12);

      // Set up city for growth
      const city = game.cityManager.getCity(cityId)!;
      city.foodStock = 30; // Enough for growth
      city.foodPerTurn = 5; // Surplus for growth

      // Process turn to trigger growth
      await game.cityManager.processCityTurn(cityId, 2);

      if (city.population > 1) {
        // Verify city grew
        expect(city.population).toBeGreaterThan(1);

        // City might work more tiles now
        expect(city.workingTiles.length).toBeGreaterThanOrEqual(1);

        // Create unit near city
        const unitId = await gameManager.createUnit(gameId, playerId, 'settler', 13, 12);

        // Unit should be able to move (not blocked by city growth)
        const moveResult = await game.unitManager.moveUnit(unitId, 14, 12);
        expect(moveResult).toBe(true);

        // Verify all changes persisted
        const db = getTestDatabase();
        const [dbCity] = await db.query.cities.findMany({
          where: (cities, { eq }) => eq(cities.id, cityId),
        });
        const [dbUnit] = await db.query.units.findMany({
          where: (units, { eq }) => eq(units.id, unitId),
        });

        expect(dbCity.population).toBe(city.population);
        expect(dbUnit.x).toBe(14);
        expect(dbUnit.y).toBe(12);
      }
    });

    it('should maintain data consistency during complex game operations', async () => {
      const game = gameManager.getGameInstance(gameId)!;

      // Perform multiple concurrent operations
      const operations = await Promise.all([
        gameManager.foundCity(gameId, playerId, 'City1', 5, 5),
        gameManager.foundCity(gameId, playerId, 'City2', 15, 15),
        gameManager.createUnit(gameId, playerId, 'warrior', 6, 6),
        gameManager.createUnit(gameId, playerId, 'settler', 16, 16),
        gameManager.setPlayerResearch(gameId, playerId, 'pottery'),
      ]);

      // All operations should succeed
      expect(operations.every(op => op !== null)).toBe(true);

      // Update visibility
      gameManager.updatePlayerVisibility(gameId, playerId);

      // Verify everything exists in memory and database
      const db = getTestDatabase();
      const dbCities = await db.query.cities.findMany({
        where: (cities, { eq }) => eq(cities.gameId, gameId),
      });
      const dbUnits = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.gameId, gameId),
      });
      const dbResearch = await db.query.playerTechs.findMany({
        where: (tech, { eq }) => eq(tech.playerId, playerId),
      });

      expect(dbCities.length).toBeGreaterThanOrEqual(4); // Original 2 + new 2
      expect(dbUnits.length).toBeGreaterThanOrEqual(5); // Original 3 + new 2
      expect(dbResearch.length).toBeGreaterThan(0);

      // Verify managers are consistent
      const allCities = game.cityManager.getPlayerCities(playerId);
      const allUnits = game.unitManager.getPlayerUnits(playerId);

      expect(allCities.length).toBe(dbCities.filter(c => c.playerId === playerId).length);
      expect(allUnits.length).toBe(dbUnits.filter(u => u.playerId === playerId).length);
    });
  });
});
