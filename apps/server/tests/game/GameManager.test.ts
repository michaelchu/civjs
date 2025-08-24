import { GameManager, GameConfig } from '../../src/game/GameManager';
import { mockIo } from '../setup';

// Get the mock from setup - Using require here because it's a mock
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const { db: mockDb } = require('../../src/database');

describe('GameManager', () => {
  let gameManager: GameManager;

  beforeEach(() => {
    // Reset singleton for testing
    (GameManager as any).instance = null;
    gameManager = GameManager.getInstance(mockIo);

    // Setup database query mock (needed for joinGame and other methods)
    mockDb.query = {
      games: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'test-game-id',
          name: 'Test Game',
          hostId: 'test-host-id',
          maxPlayers: 4,
          mapWidth: 80,
          mapHeight: 50,
          status: 'waiting',
          players: [],
        }),
      },
    };

    // Ensure mock functions exist
    mockDb.insert = jest.fn().mockReturnThis();
    mockDb.values = jest.fn().mockReturnThis();
    mockDb.returning = jest.fn().mockResolvedValue([
      {
        id: 'test-game-id',
        name: 'Test Game',
        hostId: 'test-host-id',
        maxPlayers: 4,
        mapWidth: 80,
        mapHeight: 50,
        ruleset: 'classic',
      },
    ]);
    mockDb.update = jest.fn().mockReturnThis();
    mockDb.set = jest.fn().mockReturnThis();
    mockDb.where = jest.fn(() => Promise.resolve([]));
    mockDb.select = jest.fn().mockReturnThis();
    mockDb.from = jest.fn().mockReturnThis();
    mockDb.delete = jest.fn().mockReturnThis();

    jest.clearAllMocks();
  });

  afterEach(() => {
    // Clean up games map
    gameManager['games'].clear();
    gameManager['playerToGame'].clear();
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

      expect(gameId).toBe('test-game-id');
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should initialize game with default values', async () => {
      const minimalConfig: GameConfig = {
        name: 'Minimal Game',
        hostId: 'host-123',
      };

      await gameManager.createGame(minimalConfig);

      // Verify defaults are applied in database layer
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Minimal Game',
          hostId: 'host-123',
          maxPlayers: 8, // Default applied in database layer
          mapWidth: 80, // Default applied in database layer
          mapHeight: 50, // Default applied in database layer
          ruleset: 'classic', // Default applied in database layer
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

      // Mock player creation response for joins
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
      expect(mockDb.insert).toHaveBeenCalledTimes(2); // Game + Player
    });

    it('should assign default civilization if not provided', async () => {
      await gameManager.joinGame(gameId, 'user-123');

      // Check that insert was called with a default civilization
      const insertCall = mockDb.values.mock.calls.find(
        (call: any) => call[0].civilization && call[0].civilization.startsWith('Civilization')
      );
      expect(insertCall).toBeDefined();
    });

    it('should return existing player ID if user already in game', async () => {
      // First join
      const playerId1 = await gameManager.joinGame(gameId, 'user-123', 'Romans');

      // Mock database to return existing player for second join
      mockDb.query.games.findFirst.mockResolvedValueOnce({
        id: gameId,
        name: 'Test Game',
        hostId: 'test-host-id',
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
      expect(mockDb.insert).toHaveBeenCalledTimes(2); // Only game + first player
    });

    it('should reject joining if game is not in waiting state', async () => {
      // Mock database to return active game status
      mockDb.query.games.findFirst.mockResolvedValueOnce({
        id: gameId,
        name: 'Test Game',
        hostId: 'test-host-id',
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
        hostId: 'test-host-id',
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

      await gameManager.createGame(config);

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalled();
      expect(mockDb.returning).toHaveBeenCalled();
    });
  });
});