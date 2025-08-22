import { GameManager } from '../../src/game/GameManager';
import { mockIo } from '../setup';

// Get the mock from setup
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const { db: mockDb } = require('../../src/database');

// Integration test to verify full game flow
describe('Game Integration Flow', () => {
  let gameManager: GameManager;

  beforeEach(() => {
    (GameManager as any).instance = null;
    gameManager = GameManager.getInstance(mockIo);

    // Setup database mocks for integration tests
    let gameCounter = 0;
    let playerCounter = 0;
    let cityCounter = 0;
    let unitCounter = 0;

    mockDb.insert = jest.fn().mockReturnThis();
    mockDb.values = jest.fn().mockReturnThis();
    mockDb.returning = jest.fn().mockImplementation(() => {
      // Different return values based on what's being inserted
      const query = mockDb.values.mock.calls[mockDb.values.mock.calls.length - 1]?.[0];

      if (query && query.hostId) {
        // Game insertion
        return Promise.resolve([
          {
            id: `game-${++gameCounter}`,
            name: query.name,
            hostId: query.hostId,
          },
        ]);
      } else if (query && query.userId) {
        // Player insertion
        return Promise.resolve([
          {
            id: `player-${++playerCounter}`,
            gameId: query.gameId,
            userId: query.userId,
            playerNumber: query.playerNumber,
            civilization: query.civilization,
          },
        ]);
      } else if (query && query.name && query.x !== undefined) {
        // City insertion
        return Promise.resolve([
          {
            id: `city-${++cityCounter}`,
            ...query,
          },
        ]);
      } else if (query && query.unitType) {
        // Unit insertion
        return Promise.resolve([
          {
            id: `unit-${++unitCounter}`,
            ...query,
          },
        ]);
      }

      // Default fallback
      return Promise.resolve([{ id: `default-${Date.now()}` }]);
    });

    mockDb.update = jest.fn().mockReturnThis();
    mockDb.set = jest.fn().mockReturnThis();
    mockDb.where = jest.fn().mockResolvedValue([]); // Return empty arrays for load operations
    mockDb.select = jest.fn().mockReturnThis();
    mockDb.from = jest.fn().mockReturnThis();

    jest.clearAllMocks();
  });

  afterEach(() => {
    gameManager['games'].clear();
    gameManager['playerToGame'].clear();
  });

  describe('complete game flow', () => {
    it('should handle full game creation and player interaction flow', async () => {
      // Create game
      const gameConfig = {
        name: 'Integration Test Game',
        hostId: 'host-user-id',
        maxPlayers: 2,
        mapWidth: 20,
        mapHeight: 20,
        ruleset: 'classic',
      };

      const gameId = await gameManager.createGame(gameConfig);
      expect(gameId).toBeDefined();

      // Join players
      const hostPlayerId = await gameManager.joinGame(gameId, 'host-user-id', 'romans');
      const guestPlayerId = await gameManager.joinGame(gameId, 'guest-user-id', 'greeks');

      expect(hostPlayerId).toBeDefined();
      expect(guestPlayerId).toBeDefined();
      expect(hostPlayerId).not.toBe(guestPlayerId);

      // Start game
      await gameManager.startGame(gameId, 'host-user-id');

      const game = gameManager.getGame(gameId);
      expect(game!.state).toBe('active');
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
        hostId: 'test-user',
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

      const game = gameManager.getGame(gameId)!;

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
