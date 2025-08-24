import { GameManager, GameConfig } from '../../src/game/GameManager';
import { mockIo } from '../setup';

// Get the mock from setup - Using require here because it's a mock
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const { db: mockDb } = require('../../src/database');

// Note: We don't mock managers here to test real integration
// This allows us to catch integration bugs between GameManager and its components

describe('GameManager', () => {
  let gameManager: GameManager;

  beforeEach(() => {
    // Reset singleton for testing
    (GameManager as any).instance = null;
    gameManager = GameManager.getInstance(mockIo);

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
    mockDb.where = jest.fn().mockResolvedValue([]); // Used for unit loading and general where clauses
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
      expect(gameManager['games'].has(gameId)).toBe(true);

      const gameInstance = gameManager['games'].get(gameId);
      expect(gameInstance).toBeDefined();
      expect(gameInstance!.config.name).toBe('Test Game');
      expect(gameInstance!.state).toBe('waiting');
      expect(gameInstance!.players.size).toBe(0);
    });

    it('should initialize game with default values', async () => {
      const minimalConfig: GameConfig = {
        name: 'Minimal Game',
        hostId: 'host-123',
      };

      const gameId = await gameManager.createGame(minimalConfig);
      const gameInstance = gameManager['games'].get(gameId);

      // The config object stores original values, defaults are applied in database layer
      expect(gameInstance!.config.name).toBe('Minimal Game');
      expect(gameInstance!.config.hostId).toBe('host-123');
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          maxPlayers: 8, // Default applied in database layer
          mapWidth: 80, // Default applied in database layer
          mapHeight: 50, // Default applied in database layer
          ruleset: 'classic', // Default applied in database layer
        })
      );
    });

    it('should create turn and map managers', async () => {
      const gameId = await gameManager.createGame(testConfig);
      const gameInstance = gameManager['games'].get(gameId);

      expect(gameInstance!.turnManager).toBeDefined();
      expect(gameInstance!.mapManager).toBeDefined();
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

      // Mock player creation response
      mockDb.returning.mockResolvedValueOnce([
        {
          id: 'player-id-1',
          gameId: 'test-game-id',
          userId: 'user-123',
          playerNumber: 1,
          civilization: 'Romans',
          leaderName: 'Leader1',
          color: { r: 255, g: 0, b: 0 },
        },
      ]);

      gameId = await gameManager.createGame(config);

      // Reset mock for player insertion
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

      const gameInstance = gameManager['games'].get(gameId);
      expect(gameInstance!.players.size).toBe(1);
      expect(gameManager['playerToGame'].get(playerId)).toBe(gameId);
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

      // Second join with same user
      const playerId2 = await gameManager.joinGame(gameId, 'user-123', 'Greeks');

      expect(playerId1).toBe(playerId2);
      expect(mockDb.insert).toHaveBeenCalledTimes(2); // Only game + first player
    });

    it('should reject joining if game is not in waiting state', async () => {
      const gameInstance = gameManager['games'].get(gameId);
      gameInstance!.state = 'active';

      await expect(gameManager.joinGame(gameId, 'user-456')).rejects.toThrow(
        'Game is not accepting new players'
      );
    });

    it('should reject joining if game is full', async () => {
      const gameInstance = gameManager['games'].get(gameId);
      gameInstance!.config.maxPlayers = 1;

      // Add one player manually
      gameInstance!.players.set('existing-player', {
        id: 'existing-player',
        userId: 'existing-user',
        playerNumber: 1,
        civilization: 'Romans',
        isReady: false,
        hasEndedTurn: false,
        isConnected: true,
        lastSeen: new Date(),
      });

      await expect(gameManager.joinGame(gameId, 'user-456')).rejects.toThrow('Game is full');
    });

    it('should throw error if game not found', async () => {
      await expect(gameManager.joinGame('non-existent-game', 'user-123')).rejects.toThrow(
        'Game not found'
      );
    });
  });

  describe('game starting', () => {
    let gameId: string;
    let gameInstance: any;

    beforeEach(async () => {
      const config: GameConfig = {
        name: 'Test Game',
        hostId: 'host-123',
        maxPlayers: 4,
      };

      gameId = await gameManager.createGame(config);
      gameInstance = gameManager['games'].get(gameId);

      // Add two players
      gameInstance.players.set('player1', {
        id: 'player1',
        userId: 'user1',
        playerNumber: 1,
        civilization: 'Romans',
        isReady: false,
        hasEndedTurn: false,
        isConnected: true,
        lastSeen: new Date(),
      });

      gameInstance.players.set('player2', {
        id: 'player2',
        userId: 'user2',
        playerNumber: 2,
        civilization: 'Greeks',
        isReady: false,
        hasEndedTurn: false,
        isConnected: true,
        lastSeen: new Date(),
      });

      // Mock map manager generateMap method
      gameInstance.mapManager.generateMap = jest.fn().mockResolvedValue(undefined);
      gameInstance.mapManager.getMapData = jest.fn().mockReturnValue({
        width: 80,
        height: 50,
        tiles: [],
        startingPositions: [],
        seed: 'test-seed',
        generatedAt: new Date(),
      });

      // Mock turn manager
      gameInstance.turnManager.initializeTurn = jest.fn().mockResolvedValue(undefined);
    });

    it('should start game successfully', async () => {
      await gameManager.startGame(gameId, 'host-123');

      expect(gameInstance.state).toBe('active');
      expect(gameInstance.currentTurn).toBe(1);
      expect(gameInstance.mapManager.generateMap).toHaveBeenCalled();
      expect(gameInstance.turnManager.initializeTurn).toHaveBeenCalled();
    });

    it('should reject start if not host', async () => {
      await expect(gameManager.startGame(gameId, 'not-host')).rejects.toThrow(
        'Only the host can start the game'
      );
    });

    it('should reject start if not enough players', async () => {
      gameInstance.players.clear();

      await expect(gameManager.startGame(gameId, 'host-123')).rejects.toThrow(
        'Need at least 2 players to start'
      );
    });

    it('should reject start if game not in waiting state', async () => {
      gameInstance.state = 'active';

      await expect(gameManager.startGame(gameId, 'host-123')).rejects.toThrow(
        'Game is not in waiting state'
      );
    });

    it('should broadcast game start to all players', async () => {
      await gameManager.startGame(gameId, 'host-123');

      // Should broadcast to game room (mocked in broadcastToGame)
      expect(mockIo.emit).toHaveBeenCalled();
    });
  });

  describe('game retrieval', () => {
    let gameId: string;

    beforeEach(async () => {
      const config: GameConfig = {
        name: 'Test Game',
        hostId: 'host-123',
      };
      gameId = await gameManager.createGame(config);
    });

    it('should get game by ID', () => {
      const game = gameManager.getGameInstance(gameId);

      expect(game).toBeDefined();
      expect(game!.id).toBe(gameId);
      expect(game!.config.name).toBe('Test Game');
    });

    it('should return undefined for non-existent game', () => {
      const game = gameManager.getGameInstance('non-existent');
      expect(game).toBeNull();
    });

    it('should get all games', () => {
      const allGames = gameManager.getAllGameInstances();

      expect(allGames).toHaveLength(1);
      expect(allGames[0].id).toBe(gameId);
    });

    it('should get active games only', () => {
      const activeGames = gameManager.getActiveGameInstances();

      expect(activeGames).toHaveLength(1);
      expect(activeGames[0].state).toBe('active'); // games are active when started
    });

    it('should filter out ended games from active games', () => {
      const gameInstance = gameManager['games'].get(gameId);
      gameInstance!.state = 'ended';

      const activeGames = gameManager.getActiveGames();
      expect(activeGames).toHaveLength(0);
    });
  });

  describe('player connection management', () => {
    let gameId: string;
    let playerId: string;

    beforeEach(async () => {
      const config: GameConfig = {
        name: 'Test Game',
        hostId: 'host-123',
      };

      gameId = await gameManager.createGame(config);

      // Mock player creation
      mockDb.returning.mockResolvedValueOnce([
        {
          id: 'player-123',
          gameId,
          userId: 'user-123',
          playerNumber: 1,
          civilization: 'Romans',
          leaderName: 'Leader1',
          color: { r: 255, g: 0, b: 0 },
        },
      ]);

      playerId = await gameManager.joinGame(gameId, 'user-123', 'Romans');
    });

    it('should update player connection status', async () => {
      await gameManager.updatePlayerConnection(playerId, false);

      const gameInstance = gameManager['games'].get(gameId);
      const player = gameInstance!.players.get(playerId);

      expect(player!.isConnected).toBe(false);
      expect(player!.lastSeen).toBeInstanceOf(Date);
    });

    it('should pause game when all players disconnect', async () => {
      const gameInstance = gameManager['games'].get(gameId);
      gameInstance!.state = 'active';

      await gameManager.updatePlayerConnection(playerId, false);

      expect(gameInstance!.state).toBe('paused');
    });

    it('should handle non-existent player gracefully', async () => {
      await expect(
        gameManager.updatePlayerConnection('non-existent-player', false)
      ).resolves.not.toThrow();
    });
  });

  describe('turn ending', () => {
    let gameId: string;
    let playerId: string;

    beforeEach(async () => {
      const config: GameConfig = {
        name: 'Test Game',
        hostId: 'host-123',
      };

      gameId = await gameManager.createGame(config);

      // Mock player creation
      mockDb.returning.mockResolvedValueOnce([
        {
          id: 'player-123',
          gameId,
          userId: 'user-123',
          playerNumber: 1,
          civilization: 'Romans',
          leaderName: 'Leader1',
          color: { r: 255, g: 0, b: 0 },
        },
      ]);

      playerId = await gameManager.joinGame(gameId, 'user-123', 'Romans');

      const gameInstance = gameManager['games'].get(gameId);
      gameInstance!.state = 'active';
      gameInstance!.turnManager.processTurn = jest.fn().mockResolvedValue(undefined);
    });

    it('should end turn for player', async () => {
      const turnAdvanced = await gameManager.endTurn(playerId);

      const gameInstance = gameManager['games'].get(gameId);
      const player = gameInstance!.players.get(playerId);

      expect(player!.hasEndedTurn).toBe(true);
      expect(turnAdvanced).toBe(true); // Single player, turn advances immediately
      expect(gameInstance!.turnManager.processTurn).toHaveBeenCalled();
    });

    it('should not advance turn if not all players ready', async () => {
      const gameInstance = gameManager['games'].get(gameId);

      // Add second player
      gameInstance!.players.set('player2', {
        id: 'player2',
        userId: 'user2',
        playerNumber: 2,
        civilization: 'Greeks',
        isReady: false,
        hasEndedTurn: false,
        isConnected: true,
        lastSeen: new Date(),
      });

      const turnAdvanced = await gameManager.endTurn(playerId);

      expect(turnAdvanced).toBe(false);
      expect(gameInstance!.turnManager.processTurn).not.toHaveBeenCalled();
    });

    it('should reject if player not in any game', async () => {
      await expect(gameManager.endTurn('non-existent-player')).rejects.toThrow(
        'Player not in any game'
      );
    });

    it('should reject if game not active', async () => {
      const gameInstance = gameManager['games'].get(gameId);
      gameInstance!.state = 'waiting';

      await expect(gameManager.endTurn(playerId)).rejects.toThrow('Game is not active');
    });
  });

  describe('game cleanup', () => {
    let gameId: string;

    beforeEach(async () => {
      const config: GameConfig = {
        name: 'Test Game',
        hostId: 'host-123',
      };
      gameId = await gameManager.createGame(config);
    });

    it('should clean up inactive games', async () => {
      // Set game as old
      const gameInstance = gameManager['games'].get(gameId);
      gameInstance!.lastActivity = new Date(Date.now() - 35 * 60 * 1000); // 35 minutes ago
      gameInstance!.state = 'waiting';

      await gameManager.cleanupInactiveGames();

      expect(gameManager['games'].has(gameId)).toBe(false);
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('should not clean up active games', async () => {
      const gameInstance = gameManager['games'].get(gameId);
      gameInstance!.state = 'active';
      gameInstance!.lastActivity = new Date(Date.now() - 35 * 60 * 1000); // 35 minutes ago

      await gameManager.cleanupInactiveGames();

      expect(gameManager['games'].has(gameId)).toBe(true);
    });

    it('should not clean up recent inactive games', async () => {
      const gameInstance = gameManager['games'].get(gameId);
      gameInstance!.lastActivity = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
      gameInstance!.state = 'waiting';

      await gameManager.cleanupInactiveGames();

      expect(gameManager['games'].has(gameId)).toBe(true);
    });
  });
});
