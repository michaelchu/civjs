import { GameManager, GameConfig } from '@game/managers/GameManager';
import {
  getTestDatabase,
  getTestDatabaseProvider,
  clearAllTables,
  generateTestUUID,
  createTestGameAndPlayer,
} from '../utils/testDatabase';
import { createBasicGameScenario } from '../fixtures/gameFixtures';
import {
  createMockSocketServer,
  findPassableUnitSites,
  findValidCitySites,
} from '../utils/gameTestUtils';
import { getTerrainMovementCost } from '@game/constants/MovementConstants';
import * as schema from '@database/schema';

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
      const hostData = await createTestGameAndPlayer();
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
    // TODO: Fix in separate PR - games auto-transitioning from waiting to active status
    it('should create and persist game to database', async () => {
      const gameId = await gameManager.createGame(testConfig);

      expect(gameId).toBeTruthy();

      // Create additional users for players
      const testDb = getTestDatabase();
      const user1Id = generateTestUUID();
      const user2Id = generateTestUUID();

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
      await gameManager.joinGame(gameId, user1Id, 'roman');
      await gameManager.joinGame(gameId, user2Id, 'greek');
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
      const minimalHostData = await createTestGameAndPlayer();
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
      const hostData = await createTestGameAndPlayer();
      const gameConfig: GameConfig = {
        name: 'Player Test Game',
        hostId: hostData.user.id,
        maxPlayers: 2,
      };
      gameId = await gameManager.createGame(gameConfig);
    });

    // TODO: Fix in separate PR - games auto-transitioning from waiting to active status
    // TODO: Fix in separate PR - games auto-transitioning from waiting to active status
    it('should join players and persist to database', async () => {
      const userId1 = generateTestUUID();
      const userId2 = generateTestUUID();

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

      const result1 = await gameManager.joinGame(gameId, userId1, 'roman');
      const result2 = await gameManager.joinGame(gameId, userId2, 'greek');

      expect(result1.playerId).toBeTruthy();
      expect(result2.playerId).toBeTruthy();
      expect(result1.playerId).not.toBe(result2.playerId);
      expect(result1.assignedNation).toBe('roman');
      expect(result2.assignedNation).toBe('greek');

      // Verify players in memory
      const game = gameManager.getGameInstance(gameId);
      expect(game!.players.size).toBe(2);

      // Verify players persisted to database
      const db = getTestDatabase();
      const dbPlayers = await db.query.players.findMany({
        where: (players, { eq }) => eq(players.gameId, gameId),
      });

      expect(dbPlayers).toHaveLength(2);
      expect(dbPlayers.some(p => p.nation === 'roman')).toBe(true);
      expect(dbPlayers.some(p => p.nation === 'greek')).toBe(true);
    });

    // TODO: Fix in separate PR - games auto-transitioning from waiting to active status
    // TODO: Fix in separate PR - games auto-transitioning from waiting to active status
    it('should reject players when game is full', async () => {
      // Fill game to capacity
      const userId1 = generateTestUUID();
      const userId2 = generateTestUUID();
      const userId3 = generateTestUUID();

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

      await gameManager.joinGame(gameId, userId1, 'roman');
      await gameManager.joinGame(gameId, userId2, 'greek');

      // Third player should be rejected
      await expect(gameManager.joinGame(gameId, userId3, 'egyptian')).rejects.toThrow();

      // Verify only 2 players in database
      const db = getTestDatabase();
      const dbPlayers = await db.query.players.findMany({
        where: (players, { eq }) => eq(players.gameId, gameId),
      });
      expect(dbPlayers).toHaveLength(2);
    });

    it('should prevent duplicate nations', async () => {
      const userId1 = generateTestUUID();
      const userId2 = generateTestUUID();

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

      await gameManager.joinGame(gameId, userId1, 'roman');

      // Second player tries same nation
      await expect(gameManager.joinGame(gameId, userId2, 'roman')).rejects.toThrow();

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
      hostData = await createTestGameAndPlayer();
      user2Data = await createTestGameAndPlayer();
    });

    // TODO: Fix in separate PR - games auto-transitioning from waiting to active status
    // TODO: Fix in separate PR - games auto-transitioning from waiting to active status
    it('should start game and initialize all managers', async () => {
      const gameConfig: GameConfig = {
        name: 'Lifecycle Test Game',
        hostId: hostData.user.id,
        maxPlayers: 4,
        mapWidth: 20,
        mapHeight: 20,
      };

      const gameId = await gameManager.createGame(gameConfig);
      // Join players
      await gameManager.joinGame(gameId, hostData.user.id, 'roman');
      await gameManager.joinGame(gameId, user2Data.user.id, 'greek');

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
    // TODO: Fix in separate PR - games auto-transitioning from waiting to active status
    it('should prevent non-host from starting game', async () => {
      const gameConfig: GameConfig = {
        name: 'Non-Host Test Game',
        hostId: hostData.user.id,
        maxPlayers: 4,
        mapWidth: 20,
        mapHeight: 20,
      };

      const gameId = await gameManager.createGame(gameConfig);
      await gameManager.joinGame(gameId, hostData.user.id, 'roman');

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
      const game = gameManager.getGameInstance(gameId)!;
      const [site] = findValidCitySites(game, playerId, 1);
      const cityId = await gameManager.foundCity(gameId, playerId, 'TestCity', site.x, site.y);

      expect(cityId).toBeTruthy();

      // Verify city exists in city manager
      const city = game.cityManager.getCity(cityId);
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

    it('founds a city on a tile explored through the recovered game visibility state', async () => {
      const game = gameManager.getGameInstance(gameId)!;
      const candidate: { x: number; y: number } | undefined = (() => {
        for (let x = 0; x < (game.config.mapWidth ?? 20); x += 1) {
          for (let y = 0; y < (game.config.mapHeight ?? 20); y += 1) {
            const tile = game.mapManager.getTile(x, y);
            if (
              tile &&
              getTerrainMovementCost(tile.terrain, 'settlers') >= 0 &&
              !tile.cityId &&
              tile.unitIds.length === 0 &&
              game.cityManager.canFoundCityAt(x, y, playerId)
            ) {
              return { x, y };
            }
          }
        }
        return undefined;
      })();

      expect(candidate).toBeDefined();
      const unitId = await gameManager.createUnit(
        gameId,
        playerId,
        'settlers',
        candidate!.x,
        candidate!.y
      );

      expect(game.visibilityManager.isTileExplored(playerId, candidate!.x, candidate!.y)).toBe(
        true
      );

      // Reproduce the stale legacy flag that caused the original regression.
      game.mapManager.getTile(candidate!.x, candidate!.y)!.isExplored = false;

      const cityId = await gameManager.foundCity(
        gameId,
        playerId,
        'Recovered Visibility City',
        candidate!.x,
        candidate!.y,
        unitId
      );

      expect(game.cityManager.getCity(cityId)?.name).toBe('Recovered Visibility City');
    });

    // TODO: Fix in separate PR - visibility system not working after DI refactoring
    // TODO: Fix in separate PR - visibility system integration
    it('should create units and update visibility', async () => {
      const unitId = await gameManager.createUnit(gameId, playerId, 'warriors', 12, 12);

      expect(unitId).toBeTruthy();

      // Verify unit exists in unit manager
      const game = gameManager.getGameInstance(gameId);
      const unit = game!.unitManager.getUnit(unitId);
      expect(unit).toBeDefined();
      expect(unit!.unitTypeId).toBe('warriors');

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
      expect(dbUnits[0].unitType).toBe('warriors');
    });

    it('should handle research progression with database persistence', async () => {
      await gameManager.setPlayerResearch(gameId, playerId, 'pottery');

      const research = gameManager.getPlayerResearch(gameId, playerId);
      expect(research?.currentTech).toBe('pottery');
      expect(research?.bulbsAccumulated).toBeGreaterThanOrEqual(0);

      // Verify research persisted to database
      const db = getTestDatabase();
      const dbResearch = await db.query.research.findMany({
        where: (state, { eq }) => eq(state.playerId, playerId),
      });
      expect(dbResearch).toHaveLength(1);
      expect(dbResearch[0].currentTech).toBe('pottery');

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

      const completedTurns = await db.query.gameTurns.findMany({
        where: (turns, { and, eq }) =>
          and(eq(turns.gameId, gameId), eq(turns.turnNumber, initialTurn)),
      });
      expect(completedTurns).toHaveLength(1);
      expect(completedTurns[0].stateSnapshot).toEqual(
        expect.objectContaining({ version: 2, turn: initialTurn })
      );
      expect((completedTurns[0].stateSnapshot as any).players).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: playerId,
            unitsBuilt: expect.any(Number),
            unitsKilled: expect.any(Number),
            unitsLost: expect.any(Number),
          }),
        ])
      );
      expect((completedTurns[0].stateSnapshot as any).diplomacy.players).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            playerId,
            relations: expect.any(Array),
          }),
        ])
      );
      expect((completedTurns[0].stateSnapshot as any).aiDiplomacy).toEqual([]);

      const phases = await db.query.turnPhases.findMany({
        where: (turnPhases, { eq }) => eq(turnPhases.turnId, completedTurns[0].id),
      });
      expect(phases).toHaveLength(11);
      expect(phases.every(phase => phase.status === 'completed')).toBe(true);

      const events = await db.query.turnEvents.findMany({
        where: (turnEvents, { eq }) => eq(turnEvents.turnId, completedTurns[0].id),
      });
      expect(events.map(event => event.eventType)).toEqual(
        expect.arrayContaining(['turn_begin', 'turn_end'])
      );

      const replay = await gameManager.getGameReplay(gameId, initialTurn);
      expect(replay?.turns).toHaveLength(1);
      expect(replay?.turns[0]).toEqual(
        expect.objectContaining({
          turn: initialTurn,
          phases: expect.any(Array),
          events: expect.any(Array),
        })
      );
    });
  });

  describe('game state consistency', () => {
    // TODO: Fix in separate PR - game loading and manager initialization issues
    // TODO: Fix in separate PR - game loading and state recovery
    it('should maintain consistency after manager reload', async () => {
      const scenario = await createBasicGameScenario();

      // Load game into first manager
      const gameId = scenario.game.id;
      await gameManager.loadGame(gameId);

      // Make some changes
      const game = gameManager.getGameInstance(gameId)!;
      const [citySite] = findValidCitySites(game, scenario.players[0].id, 1);
      const [unitSite] = findPassableUnitSites(game, 'settlers', 1, [citySite]);
      const cityId = await gameManager.foundCity(
        gameId,
        scenario.players[0].id,
        'NewCity',
        citySite.x,
        citySite.y
      );
      const unitId = await gameManager.createUnit(
        gameId,
        scenario.players[0].id,
        'settlers',
        unitSite.x,
        unitSite.y
      );

      // Create new GameManager instance
      (GameManager as any).instance = null;
      const mockIo2 = createMockSocketServer();
      const newGameManager = GameManager.getInstance(mockIo2, testDbProvider);

      // Load same game
      const newGame = await newGameManager.recoverGameInstance(gameId);
      expect(newGame).not.toBeNull();

      // Verify all data was loaded correctly
      const city = newGame!.cityManager.getCity(cityId);
      const unit = newGame!.unitManager.getUnit(unitId);

      expect(city).toBeDefined();
      expect(city!.name).toBe('NewCity');
      expect(unit).toBeDefined();
      expect(unit!.unitTypeId).toBe('settlers');

      newGameManager['games'].clear();
      newGameManager['playerToGame'].clear();
    });

    it('should handle concurrent player operations safely', async () => {
      const scenario = await createBasicGameScenario();
      const gameId = scenario.game.id;
      await gameManager.loadGame(gameId);

      const player1Id = scenario.players[0].id;
      const player2Id = scenario.players[1].id;
      const game = gameManager.getGameInstance(gameId)!;
      const [city1Site] = findValidCitySites(game, player1Id, 1);
      const [city2Site] = findValidCitySites(game, player2Id, 1, [city1Site]);
      const [unit1Site, unit2Site] = findPassableUnitSites(game, 'warriors', 2, [
        city1Site,
        city2Site,
      ]);

      // Simulate concurrent operations
      const operations = [
        gameManager.foundCity(gameId, player1Id, 'City1', city1Site.x, city1Site.y),
        gameManager.foundCity(gameId, player2Id, 'City2', city2Site.x, city2Site.y),
        gameManager.createUnit(gameId, player1Id, 'warriors', unit1Site.x, unit1Site.y),
        gameManager.createUnit(gameId, player2Id, 'warriors', unit2Site.x, unit2Site.y),
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
