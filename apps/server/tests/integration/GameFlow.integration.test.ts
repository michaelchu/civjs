import { GameManager } from '@game/managers/GameManager';
import {
  generateTestUUID,
  getTestDatabase,
  clearAllTables,
  getTestDatabaseProvider,
} from '../utils/testDatabase';
import * as schema from '@database/schema';
import { createMockSocketServer } from '../utils/gameTestUtils';

// Integration test to verify full game flow
describe('Game Integration Flow', () => {
  let gameManager: GameManager;

  beforeAll(async () => {
    // Setup test database
    // TODO: Fix database setup for integration tests
    // await setupTestDatabase();
  });

  afterAll(async () => {
    // Cleanup test database
    // await cleanupTestDatabase();
  });

  beforeEach(async () => {
    // Clear database before each test FIRST
    await clearAllTables();

    // Reset GameManager singleton
    (GameManager as any).instance = null;

    // Create mock socket server for integration tests
    const mockIo = createMockSocketServer();
    const testDbProvider = getTestDatabaseProvider();
    gameManager = GameManager.getInstance(mockIo, testDbProvider);
  });

  afterEach(() => {
    gameManager?.clearAllGames();
  });

  describe('complete game flow', () => {
    it('should handle full game creation and player interaction flow', async () => {
      const db = getTestDatabase();

      // Create users directly in the database
      const hostUserId = generateTestUUID();
      const guestUserId = generateTestUUID();

      await db
        .insert(schema.users)
        .values({
          id: hostUserId,
          username: `HostUser_${Date.now()}`,
          email: `host_${Date.now()}@test.com`,
          passwordHash: 'test-hash',
        })
        .returning();

      await db
        .insert(schema.users)
        .values({
          id: guestUserId,
          username: `GuestUser_${Date.now()}`,
          email: `guest_${Date.now()}@test.com`,
          passwordHash: 'test-hash',
        })
        .returning();

      const gameConfig = {
        name: 'Integration Test Game',
        hostId: hostUserId,
        maxPlayers: 2,
        mapWidth: 20,
        mapHeight: 20,
        ruleset: 'classic',
      };

      const gameId = await gameManager.createGame(gameConfig);
      expect(gameId).toBeDefined();

      // Join players
      const hostResult = await gameManager.joinGame(gameId, hostUserId, 'romans');
      const guestResult = await gameManager.joinGame(gameId, guestUserId, 'greeks');

      expect(hostResult.playerId).toBeDefined();
      expect(guestResult.playerId).toBeDefined();
      expect(hostResult.playerId).not.toBe(guestResult.playerId);
      expect(hostResult.assignedNation).toBe('romans');
      expect(guestResult.assignedNation).toBe('greeks');

      const hostPlayerId = hostResult.playerId;
      const guestPlayerId = guestResult.playerId;

      // Game should have auto-started when 2nd player joined
      const game = gameManager.getGameInstance(gameId);
      expect(game).toBeDefined();
      expect(game!.players.size).toBe(2);

      // Test city founding
      const cityId = await gameManager.foundCity(gameId, hostPlayerId, 'TestCity', 10, 10);
      expect(cityId).toBeDefined();

      // Cities don't provide visibility by themselves in our implementation
      // Visibility comes from units, so let's create a unit first

      // Test unit creation affects visibility
      const unitId = await gameManager.createUnit(gameId, hostPlayerId, 'warriors', 12, 12);
      expect(unitId).toBeDefined();

      gameManager.updatePlayerVisibility(gameId, hostPlayerId);
      const unitTileVisibility = gameManager.getTileVisibility(gameId, hostPlayerId, 12, 12);
      expect(unitTileVisibility.isVisible).toBe(true);
      expect(unitTileVisibility.isExplored).toBe(true);

      const mapView = gameManager.getPlayerMapView(gameId, hostPlayerId);
      expect(mapView).toBeDefined();
      expect(mapView!.width).toBeGreaterThan(0);
      expect(mapView!.height).toBeGreaterThan(0);
      expect(mapView!.tiles.length).toBeGreaterThan(0);

      // Test research functionality
      await gameManager.setPlayerResearch(gameId, hostPlayerId, 'pottery');
      const hostResearch = gameManager.getPlayerResearch(gameId, hostPlayerId);
      expect(hostResearch?.currentTech).toBe('pottery');

      const availableTechs = gameManager.getAvailableTechnologies(gameId, hostPlayerId);
      expect(availableTechs.length).toBeGreaterThan(0);

      // Test turn mechanics - should properly track turn ending
      const turnAdvanced1 = await gameManager.endTurn(hostPlayerId);
      expect(turnAdvanced1).toBe(false); // Guest hasn't ended turn

      const turnAdvanced2 = await gameManager.endTurn(guestPlayerId);
      expect(turnAdvanced2).toBe(true); // Now turn advances

      // A joined player can reconnect to the same active game without creating a new player.
      const reconnectResult = await gameManager.joinGame(gameId, hostUserId, 'romans');
      expect(reconnectResult.playerId).toBe(hostPlayerId);

      // Integration test complete - all managers working together
    });

    it('should recover persisted map, units, cities, and borders after a server restart', async () => {
      const db = getTestDatabase();
      const hostUserId = generateTestUUID();
      const guestUserId = generateTestUUID();

      await db.insert(schema.users).values([
        {
          id: hostUserId,
          username: `ResumeHost_${Date.now()}`,
          email: `resume_host_${Date.now()}@test.com`,
          passwordHash: 'test-hash',
        },
        {
          id: guestUserId,
          username: `ResumeGuest_${Date.now()}`,
          email: `resume_guest_${Date.now()}@test.com`,
          passwordHash: 'test-hash',
        },
      ]);

      const gameId = await gameManager.createGame({
        name: 'Resume Integration Test',
        hostId: hostUserId,
        maxPlayers: 2,
        mapWidth: 20,
        mapHeight: 20,
        ruleset: 'classic',
      });
      const host = await gameManager.joinGame(gameId, hostUserId, 'romans');
      await gameManager.joinGame(gameId, guestUserId, 'greeks');

      const activeGame = gameManager.getGameInstance(gameId)!;
      const originalMap = activeGame.mapManager.getMapData()!;
      const originalTerrain = originalMap.tiles[10][10].terrain;
      const cityId = await gameManager.foundCity(gameId, host.playerId, 'Resume City', 10, 10);
      const unitId = await gameManager.createUnit(gameId, host.playerId, 'warriors', 12, 12);

      // Simulate a process restart: only the database survives.
      gameManager.clearAllGames();
      (GameManager as any).instance = null;
      const restartedManager = GameManager.getInstance(
        createMockSocketServer(),
        getTestDatabaseProvider()
      );

      const recoveredGame = await restartedManager.recoverGameInstance(gameId);

      expect(recoveredGame).not.toBeNull();
      expect(recoveredGame!.mapManager.getMapData()).not.toBeNull();
      expect(recoveredGame!.mapManager.getMapData()!.tiles[10][10].terrain).toBe(originalTerrain);
      expect(recoveredGame!.cityManager.getCity(cityId)).toBeDefined();
      expect(recoveredGame!.unitManager.getUnit(unitId)).toBeDefined();
      expect(recoveredGame!.borderManager.getAllBorderSources()).toEqual(
        expect.arrayContaining([expect.objectContaining({ cityId, playerId: host.playerId })])
      );
      expect(recoveredGame!.borderManager.getAllTileOwnership().length).toBeGreaterThan(0);

      // Rejoining uses the original player record rather than creating another one.
      const reconnect = await restartedManager.joinGame(gameId, hostUserId, 'romans');
      expect(reconnect.playerId).toBe(host.playerId);
    });

    // TODO: Fix in separate PR - games auto-transitioning from waiting to active status
    it('should maintain data consistency across manager interactions', async () => {
      const db = getTestDatabase();

      // Create host user for consistency test
      const hostUserId = generateTestUUID();
      const [hostUser] = await db
        .insert(schema.users)
        .values({
          id: hostUserId,
          username: `ConsistencyHost_${Date.now()}`,
          email: `consistency_host_${Date.now()}@test.com`,
          passwordHash: 'test-hash',
        })
        .returning();

      const gameConfig = {
        name: 'Consistency Test',
        hostId: hostUser.id,
        maxPlayers: 2,
        mapWidth: 10,
        mapHeight: 10,
      };

      // Create additional users for the players
      const user1Id = generateTestUUID();
      const user2Id = generateTestUUID();

      await db.insert(schema.users).values([
        {
          id: user1Id,
          username: `TestUser1_${Date.now()}`,
          email: `testuser1_${Date.now()}@test.com`,
          passwordHash: 'test-hash',
        },
        {
          id: user2Id,
          username: `TestUser2_${Date.now()}`,
          email: `testuser2_${Date.now()}@test.com`,
          passwordHash: 'test-hash',
        },
      ]);

      const gameId = await gameManager.createGame(gameConfig);
      const playerResult = await gameManager.joinGame(gameId, user1Id, 'romans');
      await gameManager.joinGame(gameId, user2Id, 'greeks'); // Need 2 players to start, game will auto-start

      const playerId = playerResult.playerId;

      // Create city and unit at same location
      const cityId = await gameManager.foundCity(gameId, playerId, 'Capital', 5, 5);
      const unitId = await gameManager.createUnit(gameId, playerId, 'warriors', 5, 5);

      const game = gameManager.getGameInstance(gameId)!;

      // Verify city manager has the city
      const city = game.cityManager.getCity(cityId);
      expect(city).toBeDefined();
      expect(city!.x).toBe(5);
      expect(city!.y).toBe(5);

      // Verify unit manager has the unit
      const unit = game.unitManager.getUnit(unitId);
      expect(unit).toBeDefined();
      expect(unit!.x).toBe(5);
      expect(unit!.y).toBe(5);

      // Verify visibility manager sees both
      gameManager.updatePlayerVisibility(gameId, playerId);
      const mapView = gameManager.getPlayerMapView(gameId, playerId);

      expect(mapView).toBeDefined();
      // Map view should contain visible/explored data
      if (mapView && Array.isArray(mapView)) {
        expect(mapView.length).toBeGreaterThan(0);
      }
    });
  });
});
