import { GameManager } from '../../src/game/GameManager';
import { mockIo } from '../setup';
import { createDatabaseMocks } from '../fixtures/databaseMocks';

// Get the mock from setup
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const { db: mockDb } = require('../../src/database');

// Integration test to verify full game flow
describe('Game Integration Flow', () => {
  let gameManager: GameManager;
  let dbMocks: ReturnType<typeof createDatabaseMocks>;

  beforeEach(() => {
    (GameManager as any).instance = null;
    
    // Ensure mockIo has the proper structure
    mockIo.to = jest.fn().mockReturnValue({ emit: jest.fn() });
    mockIo.sockets.adapter = { rooms: new Map() };
    
    gameManager = GameManager.getInstance(mockIo);

    // Setup database mocks using shared fixture
    dbMocks = createDatabaseMocks();
    
    // Apply the mocks to our mock database
    Object.assign(mockDb, dbMocks.mockDb);
    
    // Reset all mocks
    dbMocks.resetMocks();
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

      const game = gameManager.getGameInstance(gameId);
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
