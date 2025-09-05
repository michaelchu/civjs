import { GameManager, GameConfig } from '@game/managers/GameManager';
import { Server as SocketServer } from 'socket.io';
import { createMockDatabaseProvider } from '../utils/mockDatabaseProvider';

describe('GameManager', () => {
  let gameManager: GameManager;
  let mockDatabaseProvider: any;
  let mockDb: any;
  const mockEmit = jest.fn();
  const mockIo = {
    to: jest.fn(() => ({
      emit: mockEmit,
    })),
    emit: mockEmit,
  } as unknown as SocketServer;

  beforeEach(() => {
    // Reset singleton for testing
    (GameManager as any).instance = null;

    // Reset mock functions
    (mockIo.to as jest.Mock).mockClear();
    mockEmit.mockClear();

    // Create fresh mock database provider
    mockDatabaseProvider = createMockDatabaseProvider();
    mockDb = mockDatabaseProvider.getDatabase();

    // Setup database query mocks with realistic data
    mockDb.query.games.findFirst.mockResolvedValue({
      id: 'test-game-id',
      name: 'Test Game',
      hostId: 'test-host-id',
      maxPlayers: 4,
      mapWidth: 80,
      mapHeight: 50,
      status: 'waiting',
      players: [],
    });

    // Note: MockDatabaseProvider already sets up returning() to auto-generate IDs
    // Don't override it here so we get consistent test behavior

    gameManager = GameManager.getInstance(mockIo, mockDatabaseProvider);

    jest.clearAllMocks();
  });

  afterEach(() => {
    // Clean up games map
    gameManager.clearAllGames();
  });

  describe('singleton pattern', () => {
    it('should return same instance on multiple calls', () => {
      const instance1 = GameManager.getInstance(mockIo);
      const instance2 = GameManager.getInstance(mockIo);

      expect(instance1).toBe(instance2);
      expect(instance1).toBe(gameManager);
    });
  });

  describe('game creation', () => {
    const testConfig: GameConfig = {
      name: 'Test Game',
      hostId: 'test-host-id',
      maxPlayers: 4,
      mapWidth: 80,
      mapHeight: 50,
      ruleset: 'classic',
      victoryConditions: ['conquest', 'science'],
    };

    it('should create game successfully', async () => {
      const gameId = await gameManager.createGame(testConfig);

      expect(gameId).toBe('test-id-1'); // MockDatabaseProvider returns auto-generated IDs
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalled();
      expect(mockDb.returning).toHaveBeenCalled();
    });

    it('should initialize game with default values', async () => {
      const minimalConfig: GameConfig = {
        name: 'Minimal Game',
        hostId: 'host-123',
      };

      const gameId = await gameManager.createGame(minimalConfig);

      // Verify game was created successfully
      expect(gameId).toBe('test-id-2'); // Second call gets next ID
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalled();
      expect(mockDb.returning).toHaveBeenCalled();

      // Check that the values call includes the expected minimal config with defaults
      const valuesCall = mockDb.values.mock.calls[0][0];
      expect(valuesCall).toEqual(
        expect.objectContaining({
          name: 'Minimal Game',
          hostId: 'host-123',
          gameType: 'multiplayer',
          maxPlayers: 8,
          mapWidth: 80,
          mapHeight: 50,
          ruleset: 'classic',
        })
      );
    });
  });

  describe('player joining', () => {
    let gameId: string;

    beforeEach(async () => {
      const config: GameConfig = {
        name: 'Test Game',
        hostId: 'host-123',
        maxPlayers: 4,
      };

      gameId = await gameManager.createGame(config);

      // Mock the game lookup for player joining - need to return valid game data
      mockDb.query.games.findFirst.mockResolvedValue({
        id: gameId,
        name: 'Test Game',
        hostId: 'host-123',
        maxPlayers: 4,
        mapWidth: 80,
        mapHeight: 50,
        status: 'waiting',
        players: [], // Empty players array initially
      });

      // Mock player creation response for joins - set up returning to resolve with player data
      mockDb.returning.mockResolvedValue([
        {
          id: 'player-id-1',
          gameId,
          userId: 'user-123',
          playerNumber: 1,
          civilization: 'Romans',
          leaderName: 'Leader1',
          color: { r: 255, g: 0, b: 0 },
        },
      ]);
    });

    it('should allow player to join game', async () => {
      const playerId = await gameManager.joinGame(gameId, 'user-123', 'Romans');

      expect(playerId).toBe('player-id-1');
      // Should have been called for both game creation and player creation
      expect(mockDb.insert).toHaveBeenCalledTimes(2); // Game + Player
    });

    it('should assign default civilization if not provided', async () => {
      const playerId = await gameManager.joinGame(gameId, 'user-123');

      expect(playerId).toBe('player-id-1');
      // Check that a player was successfully created
      expect(mockDb.insert).toHaveBeenCalledTimes(2); // Game + Player
      expect(mockDb.returning).toHaveBeenCalled();
    });

    it('should return existing player ID if user already in game', async () => {
      // First join
      const playerId1 = await gameManager.joinGame(gameId, 'user-123', 'Romans');

      // Mock database to return existing player for second join
      mockDb.query.games.findFirst.mockResolvedValueOnce({
        id: gameId,
        name: 'Test Game',
        hostId: 'host-123',
        maxPlayers: 4,
        status: 'waiting',
        players: [
          {
            id: 'player-id-1',
            userId: 'user-123',
            playerNumber: 1,
            civilization: 'Romans',
          },
        ],
      });

      // Second join with same user
      const playerId2 = await gameManager.joinGame(gameId, 'user-123', 'Greeks');

      expect(playerId1).toBe(playerId2);
      expect(playerId1).toBe('player-id-1');
    });

    it('should reject joining if game is not in waiting state', async () => {
      // Mock database to return active game status
      mockDb.query.games.findFirst.mockResolvedValueOnce({
        id: gameId,
        name: 'Test Game',
        hostId: 'host-123',
        maxPlayers: 4,
        status: 'active', // Game is active, not waiting
        players: [],
      });

      await expect(gameManager.joinGame(gameId, 'user-456')).rejects.toThrow(
        'Game is not accepting new players'
      );
    });

    it('should reject joining if game is full', async () => {
      // Mock database to return full game
      mockDb.query.games.findFirst.mockResolvedValueOnce({
        id: gameId,
        name: 'Test Game',
        hostId: 'host-123',
        maxPlayers: 1,
        status: 'waiting',
        players: [
          {
            id: 'existing-player',
            userId: 'existing-user',
            playerNumber: 1,
            civilization: 'Romans',
          },
        ],
      });

      await expect(gameManager.joinGame(gameId, 'user-456')).rejects.toThrow('Game is full');
    });

    it('should throw error if game not found', async () => {
      // Mock database to return null for non-existent game
      mockDb.query.games.findFirst.mockResolvedValueOnce(null);

      await expect(gameManager.joinGame('non-existent-game', 'user-123')).rejects.toThrow(
        'Game not found'
      );
    });
  });

  describe('database query functionality', () => {
    it('should have query API available', () => {
      expect(mockDb.query).toBeDefined();
      expect(mockDb.query.games).toBeDefined();
      expect(mockDb.query.games.findFirst).toBeDefined();
    });

    it('should handle database operations', async () => {
      const config: GameConfig = {
        name: 'Test Game',
        hostId: 'test-host-id',
      };

      const gameId = await gameManager.createGame(config);

      expect(gameId).toBeTruthy(); // Should return a valid game ID
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalled();
      expect(mockDb.returning).toHaveBeenCalled();
    });
  });

  // Safe tests that don't trigger complex Socket.IO dependencies
  describe('safe game queries', () => {
    let gameId: string;

    beforeEach(async () => {
      gameId = await gameManager.createGame({
        name: 'Query Test Game',
        hostId: 'host-123',
      });
    });

    describe('getGame', () => {
      it('should return game data for valid game ID', async () => {
        mockDb.query.games.findFirst.mockResolvedValueOnce({
          id: gameId,
          name: 'Test Game',
          status: 'waiting',
          players: [],
        });

        const game = await gameManager.getGame(gameId);

        expect(game).toBeDefined();
        if (game) {
          expect(game.id).toBe(gameId);
          expect(game.name).toBe('Test Game');
        }
      });

      it('should return null for invalid game ID', async () => {
        mockDb.query.games.findFirst.mockResolvedValueOnce(null);

        const game = await gameManager.getGame('invalid-id');

        expect(game).toBeNull();
      });
    });

    describe('getGameByPlayerId', () => {
      it('should return null for invalid player', async () => {
        mockDb.query.games.findFirst.mockResolvedValueOnce(null);

        const game = await gameManager.getGameByPlayerId('invalid-player');

        expect(game).toBeNull();
      });
    });

    describe('getAllGamesFromDatabase', () => {
      it('should handle database queries without crashing', async () => {
        // Simple test to ensure method exists and handles basic call
        const result = await gameManager.getAllGamesFromDatabase();

        // Should return an array (might be empty due to mocking)
        expect(Array.isArray(result)).toBe(true);
      });
    });

    describe('loadGame', () => {
      it('should return null if game not found in database', async () => {
        mockDb.query.games.findFirst.mockResolvedValueOnce(null);

        const result = await gameManager.loadGame('non-existent-game');

        expect(result).toBeNull();
      });
    });

    describe('requestPath', () => {
      it('should use getGameInstance for unit pathfinding requests', async () => {
        const gameId = 'test-game-id';
        const playerId = 'test-player';
        const unitId = 'test-unit';
        const targetX = 10;
        const targetY = 10;

        // Mock player-to-game mapping
        (gameManager as any).playerToGame.set(playerId, gameId);

        // Mock a game instance with proper structure
        const mockGameInstance = {
          state: 'active',
          unitManager: {
            getUnit: jest.fn().mockResolvedValue({
              id: unitId,
              playerId: playerId,
              x: 5,
              y: 5,
              movementLeft: 3,
            }),
          },
          pathfindingManager: {
            findPath: jest.fn().mockResolvedValue({
              path: [
                { x: 5, y: 5, moveCost: 0 },
                { x: 10, y: 10, moveCost: 3 },
              ],
              totalCost: 3,
              estimatedTurns: 1,
              valid: true,
            }),
          },
        };

        // Mock the games map to return our mock instance
        (gameManager as any).games.set(gameId, mockGameInstance);

        const result = await gameManager.requestPath(playerId, unitId, targetX, targetY);

        // Verify successful pathfinding result
        expect(result.success).toBe(true);
        expect(result.path).toBeDefined();
        expect(result.path?.tiles).toHaveLength(2);
        expect(result.error).toBeUndefined();
      });

      it('should handle missing game instance gracefully', async () => {
        const playerId = 'test-player';
        const unitId = 'test-unit';

        // Mock getGameInstance to return null
        jest.spyOn(gameManager, 'getGameInstance').mockReturnValue(null);

        const result = await gameManager.requestPath(playerId, unitId, 10, 10);

        // Should return failure when game instance not found
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.path).toBeUndefined();
      });

      it('should handle missing unit gracefully', async () => {
        const gameId = 'test-game-id';
        const playerId = 'test-player';
        const unitId = 'missing-unit';

        // Mock player-to-game mapping
        (gameManager as any).playerToGame.set(playerId, gameId);

        const mockGameInstance = {
          state: 'active',
          unitManager: {
            getUnit: jest.fn().mockResolvedValue(null), // Unit not found
          },
        };

        (gameManager as any).games.set(gameId, mockGameInstance);

        const result = await gameManager.requestPath(playerId, unitId, 10, 10);

        expect(result.success).toBe(false);
        expect(result.error).toContain('Unit not found');
      });

      it('should validate unit ownership', async () => {
        const gameId = 'test-game-id';
        const playerId = 'test-player';
        const unitId = 'enemy-unit';

        // Mock player-to-game mapping
        (gameManager as any).playerToGame.set(playerId, gameId);

        const mockGameInstance = {
          state: 'active',
          unitManager: {
            getUnit: jest.fn().mockResolvedValue({
              id: unitId,
              playerId: 'different-player', // Different owner
              x: 5,
              y: 5,
            }),
          },
        };

        (gameManager as any).games.set(gameId, mockGameInstance);

        const result = await gameManager.requestPath(playerId, unitId, 10, 10);

        expect(result.success).toBe(false);
        expect(result.error).toContain('does not belong to player');
      });

      it('should return proper path structure for ActionSystem compatibility', async () => {
        const gameId = 'test-game-id';
        const playerId = 'test-player';
        const unitId = 'test-unit';
        const targetX = 7;
        const targetY = 5;

        // Mock player-to-game mapping
        (gameManager as any).playerToGame.set(playerId, gameId);

        const mockPathResult = {
          path: [
            { x: 5, y: 5, moveCost: 0 },
            { x: 6, y: 5, moveCost: 1 },
            { x: 7, y: 5, moveCost: 1 },
          ],
          totalCost: 2,
          estimatedTurns: 1,
          valid: true,
        };

        const mockGameInstance = {
          state: 'active',
          unitManager: {
            getUnit: jest.fn().mockResolvedValue({
              id: unitId,
              playerId: playerId,
              x: 5,
              y: 5,
              movementLeft: 3,
            }),
          },
          pathfindingManager: {
            findPath: jest.fn().mockResolvedValue(mockPathResult),
          },
        };

        (gameManager as any).games.set(gameId, mockGameInstance);

        const result = await gameManager.requestPath(playerId, unitId, targetX, targetY);

        // Verify the result has the expected structure for ActionSystem
        expect(result).toHaveProperty('success', true);
        expect(result).toHaveProperty('path');
        expect(result.path).toHaveProperty('unitId', unitId);
        expect(result.path).toHaveProperty('targetX', targetX);
        expect(result.path).toHaveProperty('targetY', targetY);
        expect(result.path).toHaveProperty('tiles');
        expect(result.path).toHaveProperty('totalCost', 2);
        expect(result.path).toHaveProperty('estimatedTurns', 1);
        expect(result.path).toHaveProperty('valid', true);

        // Verify tiles array structure
        expect(Array.isArray(result.path?.tiles)).toBe(true);
        expect(result.path?.tiles).toHaveLength(3);
      });
    });
  });

  describe('error handling', () => {
    it('should handle database connection errors', async () => {
      // Mock database error during game creation by making returning throw
      mockDb.returning.mockImplementationOnce(() => {
        throw new Error('Database connection failed');
      });

      await expect(
        gameManager.createGame({
          name: 'Error Test',
          hostId: 'host-123',
        })
      ).rejects.toThrow('Database connection failed');
    });

    it('should handle invalid game configuration gracefully', async () => {
      // Test with minimal configuration
      const minimalConfig = {
        name: 'Minimal Test',
        hostId: 'host-123',
      };

      const gameId = await gameManager.createGame(minimalConfig);

      expect(gameId).toBeTruthy(); // Should return a valid game ID
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });
});
