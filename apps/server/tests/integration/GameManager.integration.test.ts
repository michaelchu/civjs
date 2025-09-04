import { GameManager, GameConfig } from '../../src/game/GameManager';
import {
  getTestDatabase,
  getTestDatabaseProvider,
  clearAllTables,
  generateTestUUID,
  createTestGameAndPlayer,
} from '../utils/testDatabase';
import { createBasicGameScenario } from '../fixtures/gameFixtures';
import { createMockSocketServer } from '../utils/gameTestUtils';
import * as schema from '../../src/database/schema';

describe('GameManager - Integration Tests with Real Database', () => {
  let gameManager: GameManager;
  let testDbProvider: ReturnType<typeof getTestDatabaseProvider>;

  beforeEach(async () => {
    // Clear database before each test
    await clearAllTables();

    // Reset singleton for testing
    (GameManager as any).instance = null;
    const mockIo = createMockSocketServer();

    // Create test database provider
    testDbProvider = getTestDatabaseProvider();
    gameManager = GameManager.getInstance(mockIo, testDbProvider);
  });

  afterEach(async () => {
    // Clean up after each test
    gameManager?.clearAllGames();
  });

  describe('singleton pattern', () => {
    it('should return same instance on multiple calls', () => {
      const mockIo = createMockSocketServer();
      const instance1 = GameManager.getInstance(mockIo);
      const instance2 = GameManager.getInstance(mockIo);

      expect(instance1).toBe(instance2);
      expect(instance1).toBe(gameManager);
    });
  });

  describe('game creation with real persistence', () => {
    let testHostId: string;
    let testConfig: GameConfig;

    beforeEach(async () => {
      // Create a user first for the host
      const hostData = await createTestGameAndPlayer('9001', '9002');
      testHostId = hostData.user.id;
      testConfig = {
        name: 'Integration Test Game',
        hostId: testHostId,
        maxPlayers: 4,
        mapWidth: 80,
        mapHeight: 50,
        ruleset: 'classic',
        victoryConditions: ['conquest', 'science'],
      };
    });

    // TODO: Fix in separate PR - games auto-transitioning from waiting to active status
    it.skip('should create and persist game to database', async () => {
      const gameId = await gameManager.createGame(testConfig);

      expect(gameId).toBeTruthy();

      // Create additional users for players
      const testDb = getTestDatabase();
      const user1Id = generateTestUUID('1001');
      const user2Id = generateTestUUID('1002');

      await testDb.insert(schema.users).values([
        {
          id: user1Id,
          username: `Player1_${Date.now()}`,
          email: `player1_${Date.now()}@test.com`,
          passwordHash: 'test-hash',
        },
        {
          id: user2Id,
          username: `Player2_${Date.now()}`,
          email: `player2_${Date.now()}@test.com`,
          passwordHash: 'test-hash',
        },
      ]);

      // Add players - game will auto-start when minimum players join
      await gameManager.joinGame(gameId, user1Id, 'romans');
      await gameManager.joinGame(gameId, user2Id, 'greeks');
      // Game should auto-start after second player joins (MIN_PLAYERS_TO_START=2)

      // Verify game exists in memory
      const game = gameManager.getGameInstance(gameId);
      expect(game).toBeDefined();
      expect(game!.config.name).toBe('Integration Test Game');
      expect(game!.config.maxPlayers).toBe(4);

      // Verify game was persisted to database
      const db = getTestDatabase();
      const dbGames = await db.query.games.findMany({
        where: (games, { eq }) => eq(games.id, gameId),
      });

      expect(dbGames).toHaveLength(1);
      expect(dbGames[0].name).toBe('Integration Test Game');
      expect(dbGames[0].hostId).toBe(testHostId);
      expect(dbGames[0].maxPlayers).toBe(4);
      expect(dbGames[0].mapWidth).toBe(80);
      expect(dbGames[0].mapHeight).toBe(50);
      expect(dbGames[0].ruleset).toBe('classic');
    });

    it('should apply defaults for minimal game config', async () => {
      const minimalHostData = await createTestGameAndPlayer('9003', '9004');
      const minimalConfig: GameConfig = {
        name: 'Minimal Game',
        hostId: minimalHostData.user.id,
      };

      const gameId = await gameManager.createGame(minimalConfig);

      // Verify defaults in database
      const db = getTestDatabase();
      const [dbGame] = await db.query.games.findMany({
        where: (games, { eq }) => eq(games.id, gameId),
      });

      expect(dbGame.name).toBe('Minimal Game');
      expect(dbGame.hostId).toBe(minimalHostData.user.id);
      expect(dbGame.maxPlayers).toBe(8); // Default (not 4)
      expect(dbGame.mapWidth).toBe(80); // Default
      expect(dbGame.mapHeight).toBe(50); // Default
      expect(dbGame.turnTimeLimit).toBe(300); // Default
      expect(dbGame.status).toBe('waiting'); // Default
    });
  });

  describe('player management with database integration', () => {
    let gameId: string;

    beforeEach(async () => {
      const hostData = await createTestGameAndPlayer('9005', '9006');
      const gameConfig: GameConfig = {
        name: 'Player Test Game',
        hostId: hostData.user.id,
        maxPlayers: 2,
      };
      gameId = await gameManager.createGame(gameConfig);
    });

    // TODO: Fix in separate PR - games auto-transitioning from waiting to active status  
    it.skip('should join players and persist to database', async () => {
      const userId1 = generateTestUUID('0011');
      const userId2 = generateTestUUID('0012');

      // Create users first
      const testDb = getTestDatabase();
      await testDb.insert(schema.users).values([
        {
          id: userId1,
          username: `Player1_${Date.now()}`,
          email: `player1_${Date.now()}@test.com`,
          passwordHash: 'test-hash',
        },
        {
          id: userId2,
          username: `Player2_${Date.now()}`,
          email: `player2_${Date.now()}@test.com`,
          passwordHash: 'test-hash',
        },
      ]);

      const playerId1 = await gameManager.joinGame(gameId, userId1, 'romans');
      const playerId2 = await gameManager.joinGame(gameId, userId2, 'greeks');

      expect(playerId1).toBeTruthy();
      expect(playerId2).toBeTruthy();
      expect(playerId1).not.toBe(playerId2);

      // Verify players in memory
      const game = gameManager.getGameInstance(gameId);
      expect(game!.players.size).toBe(2);

      // Verify players persisted to database
      const db = getTestDatabase();
      const dbPlayers = await db.query.players.findMany({
        where: (players, { eq }) => eq(players.gameId, gameId),
      });

      expect(dbPlayers).toHaveLength(2);
      expect(dbPlayers.some(p => p.nation === 'romans')).toBe(true);
      expect(dbPlayers.some(p => p.nation === 'greeks')).toBe(true);
    });

    // TODO: Fix in separate PR - games auto-transitioning from waiting to active status
    it.skip('should reject players when game is full', async () => {
      // Fill game to capacity
      const userId1 = generateTestUUID('0021');
      const userId2 = generateTestUUID('0022');
      const userId3 = generateTestUUID('0023');

      // Create users first
      const testDb = getTestDatabase();
      await testDb.insert(schema.users).values([
        {
          id: userId1,
          username: `FullGame1_${Date.now()}`,
          email: `fullgame1_${Date.now()}@test.com`,
          passwordHash: 'test-hash',
        },
        {
          id: userId2,
          username: `FullGame2_${Date.now()}`,
          email: `fullgame2_${Date.now()}@test.com`,
          passwordHash: 'test-hash',
        },
        {
          id: userId3,
          username: `FullGame3_${Date.now()}`,
          email: `fullgame3_${Date.now()}@test.com`,
          passwordHash: 'test-hash',
        },
      ]);

      await gameManager.joinGame(gameId, userId1, 'romans');
      await gameManager.joinGame(gameId, userId2, 'greeks');

      // Third player should be rejected
      await expect(gameManager.joinGame(gameId, userId3, 'egyptians')).rejects.toThrow();

      // Verify only 2 players in database
      const db = getTestDatabase();
      const dbPlayers = await db.query.players.findMany({
        where: (players, { eq }) => eq(players.gameId, gameId),
      });
      expect(dbPlayers).toHaveLength(2);
    });

    it('should prevent duplicate nations', async () => {
      const userId1 = generateTestUUID('0031');
      const userId2 = generateTestUUID('0032');

      // Create users first
      const testDb = getTestDatabase();
      await testDb.insert(schema.users).values([
        {
          id: userId1,
          username: `DupNation1_${Date.now()}`,
          email: `dupnation1_${Date.now()}@test.com`,
          passwordHash: 'test-hash',
        },
        {
          id: userId2,
          username: `DupNation2_${Date.now()}`,
          email: `dupnation2_${Date.now()}@test.com`,
          passwordHash: 'test-hash',
        },
      ]);

      await gameManager.joinGame(gameId, userId1, 'romans');

      // Second player tries same nation
      await expect(gameManager.joinGame(gameId, userId2, 'romans')).rejects.toThrow();

      // Verify only one player in database
      const db = getTestDatabase();
      const dbPlayers = await db.query.players.findMany({
        where: (players, { eq }) => eq(players.gameId, gameId),
      });
      expect(dbPlayers).toHaveLength(1);
    });
  });

  describe('game lifecycle with real state management', () => {
    let hostData: { game: any; player: any; user: any };
    let user2Data: { game: any; player: any; user: any };

    beforeEach(async () => {
      hostData = await createTestGameAndPlayer('9007', '9008');
      user2Data = await createTestGameAndPlayer('9009', '9010');
    });

    // TODO: Fix in separate PR - games auto-transitioning from waiting to active status
    it.skip('should start game and initialize all managers', async () => {
      const gameConfig: GameConfig = {
        name: 'Lifecycle Test Game',
        hostId: hostData.user.id,
        maxPlayers: 4,
        mapWidth: 20,
        mapHeight: 20,
      };

      const gameId = await gameManager.createGame(gameConfig);
      // Join players
      await gameManager.joinGame(gameId, hostData.user.id, 'romans');
      await gameManager.joinGame(gameId, user2Data.user.id, 'greeks');

      // Give auto-start a chance, but then manually start if needed
      await new Promise(resolve => setTimeout(resolve, 300));

      let game = gameManager.getGameInstance(gameId);
      if (!game) {
        // Auto-start didn't work, manually start
        await gameManager.startGame(gameId, hostData.user.id);
        game = gameManager.getGameInstance(gameId);
      }

      expect(game).toBeDefined();
      expect(game!.state).toBe('active');

      // Verify managers are initialized
      expect(game!.cityManager).toBeDefined();
      expect(game!.unitManager).toBeDefined();
      expect(game!.researchManager).toBeDefined();
      expect(game!.turnManager).toBeDefined();

      // Verify game status in database
      const db = getTestDatabase();
      const [dbGame] = await db.query.games.findMany({
        where: (games, { eq }) => eq(games.id, gameId),
      });
      expect(dbGame.status).toBe('active');
    });

    // TODO: Fix in separate PR - game state transition logic issues  
    it.skip('should prevent non-host from starting game', async () => {
      const gameConfig: GameConfig = {
        name: 'Non-Host Test Game',
        hostId: hostData.user.id,
        maxPlayers: 4,
        mapWidth: 20,
        mapHeight: 20,
      };

      const gameId = await gameManager.createGame(gameConfig);
      await gameManager.joinGame(gameId, hostData.user.id, 'romans');

      // Try to start game as non-host (should fail)
      await expect(gameManager.startGame(gameId, user2Data.user.id)).rejects.toThrow(
        'Only the host can start the game'
      );

      // Game should still be in waiting status since no valid start occurred
      const db = getTestDatabase();
      const [dbGame] = await db.query.games.findMany({
        where: (games, { eq }) => eq(games.id, gameId),
      });
      expect(dbGame.status).toBe('waiting');
    });
  });

  describe('cross-manager operations with real persistence', () => {
    let gameId: string;
    let playerId: string;

    beforeEach(async () => {
      const scenario = await createBasicGameScenario();
      gameId = scenario.game.id;
      playerId = scenario.players[0].id;

      // Load the existing game into GameManager
      await gameManager.loadGame(gameId);
    });

    it('should create cities and persist across managers', async () => {
      const cityId = await gameManager.foundCity(gameId, playerId, 'TestCity', 5, 5);

      expect(cityId).toBeTruthy();

      // Verify city exists in city manager
      const game = gameManager.getGameInstance(gameId);
      const city = game!.cityManager.getCity(cityId);
      expect(city).toBeDefined();
      expect(city!.name).toBe('TestCity');

      // Verify city persisted to database
      const db = getTestDatabase();
      const dbCities = await db.query.cities.findMany({
        where: (cities, { eq }) => eq(cities.id, cityId),
      });
      expect(dbCities).toHaveLength(1);
      expect(dbCities[0].name).toBe('TestCity');
    });

    it('should create units and update visibility', async () => {
      const unitId = await gameManager.createUnit(gameId, playerId, 'warrior', 12, 12);

      expect(unitId).toBeTruthy();

      // Verify unit exists in unit manager
      const game = gameManager.getGameInstance(gameId);
      const unit = game!.unitManager.getUnit(unitId);
      expect(unit).toBeDefined();
      expect(unit!.unitTypeId).toBe('warrior');

      // Test visibility update
      gameManager.updatePlayerVisibility(gameId, playerId);
      const visibility = gameManager.getTileVisibility(gameId, playerId, 12, 12);
      expect(visibility.isVisible).toBe(true);

      // Verify unit persisted to database
      const db = getTestDatabase();
      const dbUnits = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.id, unitId),
      });
      expect(dbUnits).toHaveLength(1);
      expect(dbUnits[0].unitType).toBe('warrior');
    });

    it('should handle research progression with database persistence', async () => {
      await gameManager.setPlayerResearch(gameId, playerId, 'pottery');

      const research = gameManager.getPlayerResearch(gameId, playerId);
      expect(research?.currentTech).toBe('pottery');
      expect(research?.bulbsAccumulated).toBeGreaterThanOrEqual(0);

      // Verify research persisted to database
      const db = getTestDatabase();
      const dbResearch = await db.query.playerTechs.findMany({
        where: (tech, { eq }) => eq(tech.playerId, playerId),
      });
      expect(dbResearch.length).toBeGreaterThan(0);

      const availableTechs = gameManager.getAvailableTechnologies(gameId, playerId);
      expect(availableTechs.length).toBeGreaterThan(0);
    });

    it('should handle turn progression across all managers', async () => {
      const game = gameManager.getGameInstance(gameId);
      const initialTurn = game!.turnManager.getCurrentTurn();

      // End turn for first player
      const turnAdvanced1 = await gameManager.endTurn(playerId);
      expect(turnAdvanced1).toBe(false); // Other player hasn't ended turn

      // End turn for second player
      const player2 = Array.from(game!.players.values())[1];
      const turnAdvanced2 = await gameManager.endTurn(player2.id);
      expect(turnAdvanced2).toBe(true); // Turn should advance

      expect(game!.turnManager.getCurrentTurn()).toBe(initialTurn + 1);

      // Verify turn advancement persisted
      const db = getTestDatabase();
      const [dbGame] = await db.query.games.findMany({
        where: (games, { eq }) => eq(games.id, gameId),
      });
      expect(dbGame.currentTurn).toBe(initialTurn + 1);
    });
  });

  describe('game state consistency', () => {
    // TODO: Fix in separate PR - game loading and manager initialization issues
    it.skip('should maintain consistency after manager reload', async () => {
      const scenario = await createBasicGameScenario();

      // Load game into first manager
      const gameId = scenario.game.id;
      await gameManager.loadGame(gameId);

      // Make some changes
      const cityId = await gameManager.foundCity(gameId, scenario.players[0].id, 'NewCity', 8, 8);
      const unitId = await gameManager.createUnit(gameId, scenario.players[0].id, 'settler', 9, 9);

      // Create new GameManager instance
      (GameManager as any).instance = null;
      const mockIo2 = createMockSocketServer();
      const newGameManager = GameManager.getInstance(mockIo2);

      // Load same game
      await newGameManager.loadGame(gameId);

      const newGame = newGameManager.getGameInstance(gameId);
      expect(newGame).toBeDefined();

      // Verify all data was loaded correctly
      const city = newGame!.cityManager.getCity(cityId);
      const unit = newGame!.unitManager.getUnit(unitId);

      expect(city).toBeDefined();
      expect(city!.name).toBe('NewCity');
      expect(unit).toBeDefined();
      expect(unit!.unitTypeId).toBe('settler');

      newGameManager['games'].clear();
      newGameManager['playerToGame'].clear();
    });

    it('should handle concurrent player operations safely', async () => {
      const scenario = await createBasicGameScenario();
      const gameId = scenario.game.id;
      await gameManager.loadGame(gameId);

      const player1Id = scenario.players[0].id;
      const player2Id = scenario.players[1].id;

      // Simulate concurrent operations
      const operations = [
        gameManager.foundCity(gameId, player1Id, 'City1', 7, 7),
        gameManager.foundCity(gameId, player2Id, 'City2', 17, 17),
        gameManager.createUnit(gameId, player1Id, 'warrior', 6, 7),
        gameManager.createUnit(gameId, player2Id, 'warrior', 18, 17),
      ];

      const results = await Promise.all(operations);

      // All operations should succeed
      expect(results.every(result => result !== null)).toBe(true);

      // Verify all entities exist in database
      const db = getTestDatabase();
      const dbCities = await db.query.cities.findMany({
        where: (cities, { eq }) => eq(cities.gameId, gameId),
      });
      const dbUnits = await db.query.units.findMany({
        where: (units, { eq }) => eq(units.gameId, gameId),
      });

      expect(dbCities.length).toBeGreaterThanOrEqual(4); // Original 2 + new 2
      expect(dbUnits.length).toBeGreaterThanOrEqual(5); // Original 3 + new 2
    });
  });
});
