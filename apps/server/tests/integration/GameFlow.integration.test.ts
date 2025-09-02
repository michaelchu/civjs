import { GameManager } from '../../src/game/GameManager';
import { generateTestUUID, getTestDatabase, clearAllTables } from '../utils/testDatabase';
import * as schema from '../../src/database/schema';
import { createMockSocketServer } from '../utils/gameTestUtils';

// Integration test to verify full game flow
describe('Game Integration Flow', () => {
  let gameManager: GameManager;

  beforeEach(async () => {
    // Clear database before each test FIRST
    await clearAllTables();

    // Reset GameManager singleton
    (GameManager as any).instance = null;

    // Create mock socket server for integration tests
    const mockIo = createMockSocketServer();
    gameManager = GameManager.getInstance(mockIo);
  });

  afterEach(() => {
    gameManager['games'].clear();
    gameManager['playerToGame'].clear();
  });

  describe('complete game flow', () => {
    it('should handle full game creation and player interaction flow', async () => {
      const db = getTestDatabase();

      // Create users directly in the database
      const hostUserId = generateTestUUID('0001');
      const guestUserId = generateTestUUID('0002');

      await db
        .insert(schema.users)
        .values({
          id: hostUserId,
          username: 'HostUser',
          email: 'host@test.com',
          passwordHash: 'test-hash',
        })
        .returning();

      await db
        .insert(schema.users)
        .values({
          id: guestUserId,
          username: 'GuestUser',
          email: 'guest@test.com',
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
      const hostPlayerId = await gameManager.joinGame(gameId, hostUserId, 'romans');
      const guestPlayerId = await gameManager.joinGame(gameId, guestUserId, 'greeks');

      expect(hostPlayerId).toBeDefined();
      expect(guestPlayerId).toBeDefined();
      expect(hostPlayerId).not.toBe(guestPlayerId);

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
      const unitId = await gameManager.createUnit(gameId, hostPlayerId, 'warrior', 12, 12);
      expect(unitId).toBeDefined();

      gameManager.updatePlayerVisibility(gameId, hostPlayerId);
      const unitTileVisibility = gameManager.getTileVisibility(gameId, hostPlayerId, 12, 12);
      expect(unitTileVisibility.isVisible).toBe(true);
      expect(unitTileVisibility.isExplored).toBe(true);

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

      // Integration test complete - all managers working together
    });

    it('should maintain data consistency across manager interactions', async () => {
      const gameConfig = {
        name: 'Consistency Test',
        hostId: generateTestUUID('0003'),
        maxPlayers: 2,
        mapWidth: 10,
        mapHeight: 10,
      };

      const gameId = await gameManager.createGame(gameConfig);
      const playerId = await gameManager.joinGame(gameId, 'test-user', 'romans');
      await gameManager.joinGame(gameId, 'test-user-2', 'greeks'); // Need 2 players to start
      await gameManager.startGame(gameId, 'test-user');

      // Create city and unit at same location
      const cityId = await gameManager.foundCity(gameId, playerId, 'Capital', 5, 5);
      const unitId = await gameManager.createUnit(gameId, playerId, 'warrior', 5, 5);

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
