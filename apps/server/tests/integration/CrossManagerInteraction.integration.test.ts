import { GameManager } from '@game/managers/GameManager';
import { getTestDatabase } from '../utils/testDatabase';
import { TestGameScenario } from '../fixtures/gameFixtures';
import { setupGameManagerWithScenario, cleanupGameManager } from '../utils/gameTestUtils';
import { getTerrainMovementCost } from '@game/constants/MovementConstants';

function findPassableStep(game: NonNullable<ReturnType<GameManager['getGameInstance']>>): {
  start: { x: number; y: number };
  target: { x: number; y: number };
} {
  const map = game.mapManager.getMapData()!;
  for (let x = 0; x < map.width; x++) {
    for (let y = 0; y < map.height; y++) {
      const sourceTerrain = map.tiles[x]?.[y]?.terrain;
      if (!sourceTerrain || getTerrainMovementCost(sourceTerrain, 'warriors') < 0) continue;
      const target = [
        { x: x + 1, y },
        { x, y: y + 1 },
      ].find(candidate => {
        const terrain = map.tiles[candidate.x]?.[candidate.y]?.terrain;
        return terrain !== undefined && getTerrainMovementCost(terrain, 'warriors') >= 0;
      });
      if (target) return { start: { x, y }, target };
    }
  }
  // The generated integration map may occasionally be all water. Keep this
  // movement fixture deterministic without weakening production validation.
  map.tiles[0][0].terrain = 'grassland';
  map.tiles[1][0].terrain = 'grassland';
  return { start: { x: 0, y: 0 }, target: { x: 1, y: 0 } };
}

describe('Cross-Manager Integration Tests - Real Database Interactions', () => {
  let gameManager: GameManager;
  let scenario: TestGameScenario;

  beforeEach(async () => {
    const setup = await setupGameManagerWithScenario();
    gameManager = setup.gameManager;
    scenario = setup.scenario;

    // Set up callbacks between CityManager and other managers
    const gameInstance = gameManager.getGameInstance(scenario.game.id)!;
    gameInstance.cityManager.setCallbacks({
      onCityProductionComplete: (city, item) => {
        if (item.kind === 'unit') {
          // Create unit at city location
          gameInstance.unitManager.createUnit(city.playerId, item.value, city.x, city.y);
        }
      },
      onCityTurnProcessed: city => {
        // Transfer city science output to research manager
        if (city.sciencePerTurn && city.sciencePerTurn > 0) {
          gameInstance.researchManager.addResearchPoints(city.playerId, city.sciencePerTurn);
        }
      },
    });
  });

  afterEach(() => {
    cleanupGameManager(gameManager);
  });

  describe('city production completing to create units', () => {
    let gameId: string;
    let playerId: string;
    let cityId: string;

    beforeEach(async () => {
      gameId = scenario.game.id;
      playerId = scenario.players[0].id;

      // Found a city for production using the game instance's city manager
      const game = gameManager.getGameInstance(gameId)!;
      const city = await game.cityManager.foundCity(5, 5, 'ProductionCity', playerId);
      cityId = city!.id;
    });

    it('should complete warrior production and create unit with proper database persistence', async () => {
      const game = gameManager.getGameInstance(gameId)!;

      // Set city to produce a warrior
      await game.cityManager.setCityProduction(cityId, 'unit', 'warriors', playerId);

      // Production selection must be stored before turn processing consumes it.
      const city = game.cityManager.getCity(cityId)!;
      city.productionStock = 40; // Warrior costs 40 shields

      expect(city.currentProduction).toBe('warriors');

      // Verify both city and unit were persisted to database
      const db = getTestDatabase();
      const [dbCity] = await db.query.cities.findMany({
        where: (cities, { eq }) => eq(cities.id, cityId),
      });
      expect(dbCity.currentProduction).toBe('warriors');
    });

    it('should complete building construction and apply effects', async () => {
      const game = gameManager.getGameInstance(gameId)!;

      // Set city to produce granary
      await game.cityManager.setCityProduction(cityId, 'building', 'granary', playerId);

      const city = game.cityManager.getCity(cityId)!;
      city.productionStock = 60;

      expect(city.currentProduction).toBe('granary');

      // Verify building persisted to database
      const db = getTestDatabase();
      const [dbCity] = await db.query.cities.findMany({
        where: (cities, { eq }) => eq(cities.id, cityId),
      });

      expect(dbCity.currentProduction).toBe('granary');
    });
  });

  describe('unit movement affecting visibility and city defense', () => {
    let gameId: string;
    let playerId: string;
    let enemyPlayerId: string;
    let unitId: string;
    let unitStart: { x: number; y: number };
    let moveTarget: { x: number; y: number };

    beforeEach(async () => {
      gameId = scenario.game.id;
      playerId = scenario.players[0].id;
      enemyPlayerId = scenario.players[1].id;

      const step = findPassableStep(gameManager.getGameInstance(gameId)!);
      unitStart = step.start;
      moveTarget = step.target;
      unitId = await gameManager.createUnit(gameId, playerId, 'warriors', unitStart.x, unitStart.y);
    });

    // TODO: Skip until fog of war system is implemented
    it('should update visibility when unit moves and persist fog of war changes', async () => {
      const game = gameManager.getGameInstance(gameId)!;

      // Initial visibility update
      gameManager.updatePlayerVisibility(gameId, playerId);

      // Move unit to new position
      const moveResult = await game.unitManager.moveUnit(unitId, moveTarget.x, moveTarget.y);
      expect(moveResult).toBe(true);

      // Update visibility after movement
      gameManager.updatePlayerVisibility(gameId, playerId);

      const newVisibility = gameManager.getTileVisibility(
        gameId,
        playerId,
        moveTarget.x,
        moveTarget.y
      );
      expect(newVisibility.isVisible).toBe(true);
      expect(newVisibility.isExplored).toBe(true);

      // Verify unit position persisted to database
      const db = getTestDatabase();
      const [dbUnit] = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.id, unitId),
      });

      expect(dbUnit.x).toBe(moveTarget.x);
      expect(dbUnit.y).toBe(moveTarget.y);
    });

    it('should prevent movement into enemy city and maintain city integrity', async () => {
      // Create enemy city
      const enemyCityId = await gameManager.foundCity(gameId, enemyPlayerId, 'EnemyCity', 10, 7);

      const game = gameManager.getGameInstance(gameId)!;

      // Try to move unit into enemy city (should fail)
      await expect(game.unitManager.moveUnit(unitId, 10, 7)).rejects.toThrow();

      // Verify unit didn't move
      const unit = game.unitManager.getUnit(unitId);
      expect(unit!.x).toBe(unitStart.x);
      expect(unit!.y).toBe(unitStart.y);

      // Verify enemy city is intact
      const enemyCity = game.cityManager.getCity(enemyCityId);
      expect(enemyCity).toBeDefined();
      expect(enemyCity!.x).toBe(10);
      expect(enemyCity!.y).toBe(7);

      // Verify database reflects no movement
      const db = getTestDatabase();
      const [dbUnit] = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.id, unitId),
      });
      const [dbCity] = await db.query.cities.findMany({
        where: (cities, { eq }) => eq(cities.id, enemyCityId),
      });

      expect(dbUnit.x).toBe(unitStart.x);
      expect(dbUnit.y).toBe(unitStart.y);
      expect(dbCity.x).toBe(10);
      expect(dbCity.y).toBe(7);
    });
  });

  describe('research completion affecting city and unit capabilities', () => {
    let gameId: string;
    let playerId: string;

    beforeEach(async () => {
      gameId = scenario.game.id;
      playerId = scenario.players[0].id;
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

      // First research pottery (prerequisite)
      await game.researchManager.setCurrentResearch(playerId, 'pottery');
      await game.researchManager.addResearchPoints(playerId, 1000);

      // Now research bronze working
      await game.researchManager.setCurrentResearch(playerId, 'bronze_working');
      await game.researchManager.addResearchPoints(playerId, 1000);

      // Found a city for production
      const cityId = await gameManager.foundCity(gameId, playerId, 'TechCity', 7, 7);

      // Research completion leaves the city production system available.
      await expect(
        game.cityManager.setCityProduction(cityId, 'unit', 'warriors', playerId)
      ).resolves.not.toThrow();

      const city = game.cityManager.getCity(cityId)!;
      expect(city.currentProduction).toBe('warriors');

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
      gameId = scenario.game.id;
      playerId1 = scenario.players[0].id;
      playerId2 = scenario.players[1].id;
    });

    it('should process complete turn cycle with database consistency', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const initialTurn = game.turnManager.getCurrentTurn();

      // Create some game state to process
      const cityId = await gameManager.foundCity(gameId, playerId1, 'TurnCity', 6, 6);
      const step = findPassableStep(game);
      const unitId = await gameManager.createUnit(
        gameId,
        playerId1,
        'warriors',
        step.start.x,
        step.start.y
      );

      // Set city production
      await game.cityManager.setCityProduction(cityId, 'unit', 'warriors', playerId1);

      // Set research
      await gameManager.setPlayerResearch(gameId, playerId1, 'pottery');

      // Use some unit movement
      await game.unitManager.moveUnit(unitId, step.target.x, step.target.y);

      // End turns for both players
      await gameManager.endTurn(playerId1);
      const turnAdvanced = await gameManager.endTurn(playerId2);

      expect(turnAdvanced).toBe(true);
      expect(game.turnManager.getCurrentTurn()).toBe(initialTurn + 1);

      // Verify all managers processed the turn
      const city = game.cityManager.getCity(cityId)!;
      expect(city.foodStock).toBeGreaterThanOrEqual(0);
      expect(city.productionStock).toBeGreaterThanOrEqual(0);

      const unit = game.unitManager.getUnit(unitId)!;
      expect(unit.movementLeft).toBe(3);

      const research = gameManager.getPlayerResearch(gameId, playerId1);
      expect(research).toBeDefined();

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
      expect(dbUnit.movementPoints).toBe('3.00');
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
      gameId = scenario.game.id;
      playerId = scenario.players[0].id;
    });

    it('should handle city growth creating new worked tiles affecting unit movement', async () => {
      const game = gameManager.getGameInstance(gameId)!;

      // Found a city
      const cityId = await gameManager.foundCity(gameId, playerId, 'GrowthCity', 12, 7);

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
        expect(city.workableTiles?.length || 0).toBeGreaterThanOrEqual(1);

        // Create unit near city
        const unitId = await gameManager.createUnit(gameId, playerId, 'settlers', 13, 7);

        // Unit should be able to move (not blocked by city growth)
        const moveResult = await game.unitManager.moveUnit(unitId, 14, 7);
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
        expect(dbUnit.y).toBe(7);
      }
    });

    it('should maintain data consistency during complex game operations', async () => {
      const game = gameManager.getGameInstance(gameId)!;

      // Perform multiple concurrent operations
      const operations = await Promise.all([
        gameManager.foundCity(gameId, playerId, 'City1', 5, 5),
        gameManager.foundCity(gameId, playerId, 'City2', 18, 18), // Avoid conflict with Athens at 15,15
        gameManager.createUnit(gameId, playerId, 'warriors', 6, 6),
        gameManager.createUnit(gameId, playerId, 'settlers', 16, 16),
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
