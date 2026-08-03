// Mock playerColors to return consistent color
jest.mock('@utils/playerColors', () => ({
  getNextPlayerColorTheme: jest.fn(() => ({
    primary: { r: 255, g: 20, b: 147 }, // Same color for consistent testing
    secondary: { r: 255, g: 255, b: 255 },
    tertiary: { r: 0, g: 0, b: 0 },
    name: 'Test Theme',
  })),
}));

import { GameManager, GameConfig } from '@game/managers/GameManager';
import { Server as SocketServer } from 'socket.io';
import { createMockDatabaseProvider } from '../utils/mockDatabaseProvider';
import {
  SCENARIOS_NOT_ENABLED_MESSAGE,
  ScenarioUnavailableError,
} from '@game/map/ScenarioProvider';

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
      mapSizingMode: 'fixed',
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

  describe('research diplomacy state', () => {
    it('caches directional embassy, contact, and barbarian facts for research costs', async () => {
      const gameId = 'research-diplomacy-game';
      const players = new Map([
        ['learner', { id: 'learner', civilization: 'French', nation: 'french' }],
        ['peer', { id: 'peer', civilization: 'Germans', nation: 'germans' }],
        ['barbarian', { id: 'barbarian', civilization: 'Barbarian', nation: 'barbarian' }],
      ]);
      const visibilityManager = { updateAllPlayersVisibility: jest.fn() };
      (gameManager as any).games.set(gameId, { players, visibilityManager });
      (gameManager as any).diplomacyManager = {
        getSnapshot: jest.fn(async (_requestedGameId: string, playerId: string) => ({
          playerId,
          nations: [...players.values()]
            .filter(player => player.id !== playerId)
            .map(player => ({
              id: player.id,
              relation: {
                state: playerId === 'learner' && player.id === 'peer' ? 'war' : 'no_contact',
                embassy: playerId === 'learner' && player.id === 'peer',
                sharedVision: false,
              },
            })),
        })),
      };

      await (gameManager as any).refreshSharedVision(gameId);

      const researchDiplomacy = (gameManager as any).researchDiplomacyByGame.get(gameId);
      expect(researchDiplomacy.get('learner').get('peer')).toEqual({
        hasRealEmbassy: true,
        hasContact: true,
        targetIsBarbarian: false,
      });
      expect(researchDiplomacy.get('learner').get('barbarian')).toEqual({
        hasRealEmbassy: false,
        hasContact: false,
        targetIsBarbarian: true,
      });
      expect(visibilityManager.updateAllPlayersVisibility).toHaveBeenCalledWith([
        'learner',
        'peer',
        'barbarian',
      ]);
    });
  });

  describe('player connection recovery', () => {
    it('does not try to recover a waiting lobby when its player connects', async () => {
      const playerId = 'waiting-player';
      const gameId = 'waiting-game';
      (gameManager as any).playerToGame.set(playerId, gameId);
      const connectionUpdate = jest.fn().mockResolvedValue(undefined);
      (gameManager as any).playerConnectionManager.updatePlayerConnection = connectionUpdate;
      jest.spyOn(gameManager, 'getGame').mockResolvedValue({ id: gameId, status: 'waiting' });
      const recover = jest.spyOn(gameManager, 'recoverGameInstance');

      await gameManager.updatePlayerConnection(playerId, true);

      expect(recover).not.toHaveBeenCalled();
      expect(connectionUpdate).toHaveBeenCalledWith(playerId, true);
    });
  });

  describe('game creation', () => {
    const testConfig: GameConfig = {
      name: 'Test Game',
      hostId: 'test-host-id',
      maxPlayers: 4,
      mapWidth: 80,
      mapHeight: 50,
      ruleset: 'civ2civ3',
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
          ruleset: 'civ2civ3',
        })
      );
    });

    it('rejects scenario creation without writing a game record', async () => {
      const scenarioConfig: GameConfig = {
        ...testConfig,
        terrainSettings: {
          generator: 'scenario',
          scenarioId: 'earth-small',
          landmass: 'normal',
          huts: 15,
          temperature: 50,
          wetness: 50,
          rivers: 50,
          resources: 'normal',
        },
      };

      await expect(gameManager.createGame(scenarioConfig)).rejects.toEqual(
        expect.objectContaining<Partial<ScenarioUnavailableError>>({
          code: 'SCENARIOS_NOT_ENABLED',
          message: SCENARIOS_NOT_ENABLED_MESSAGE,
        })
      );
      expect(mockDb.insert).not.toHaveBeenCalled();
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
          civilization: 'roman',
          leaderName: 'Leader1',
          color: { r: 255, g: 0, b: 0 },
        },
      ]);
    });

    it('should allow player to join game', async () => {
      const result = await gameManager.joinGame(gameId, 'user-123', 'roman');

      expect(result).toEqual(
        expect.objectContaining({
          playerId: 'player-id-1',
          assignedNation: 'roman',
          assignedColor: expect.any(Object),
        })
      );
      // Should have been called for both game creation and player creation
      expect(mockDb.insert).toHaveBeenCalledTimes(2); // Game + Player
    });

    it('should assign default civilization if not provided', async () => {
      const result = await gameManager.joinGame(gameId, 'user-123');

      expect(result).toEqual(
        expect.objectContaining({
          playerId: 'player-id-1',
          assignedNation: 'american',
          assignedColor: expect.any(Object),
        })
      );
      // Check that a player was successfully created
      expect(mockDb.insert).toHaveBeenCalledTimes(2); // Game + Player
      expect(mockDb.returning).toHaveBeenCalled();
    });

    it('should return existing player ID if user already in game', async () => {
      // First join
      const result1 = await gameManager.joinGame(gameId, 'user-123', 'roman');

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
            civilization: 'roman',
            color: { r: 128, g: 128, b: 128 }, // Fallback color for consistency
          },
        ],
      });

      // Second join with same user
      const result2 = await gameManager.joinGame(gameId, 'user-123', 'Greeks');

      expect(result1).toEqual(expect.objectContaining({ playerId: 'player-id-1' }));
      expect(result2).toEqual(
        expect.objectContaining({ playerId: 'player-id-1', assignedNation: 'roman' })
      );
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
            civilization: 'roman',
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

  describe('requestMovementRange', () => {
    it('uses the authoritative pathfinding policy for owned units', async () => {
      const gameId = 'test-game-id';
      const playerId = 'test-player';
      const unitId = 'test-unit';
      (gameManager as any).playerToGame.set(playerId, gameId);

      const unit = {
        id: unitId,
        playerId,
        x: 5,
        y: 5,
        movementLeft: 3,
      };
      const findAccessibleTiles = jest.fn().mockReturnValue([
        { x: 5, y: 5, remainingMovement: 3 },
        { x: 6, y: 5, remainingMovement: 2 },
      ]);
      (gameManager as any).games.set(gameId, {
        state: 'active',
        unitManager: { getUnit: jest.fn().mockResolvedValue(unit) },
        pathfindingManager: { findAccessibleTiles },
      });

      await expect(gameManager.requestMovementRange(playerId, unitId)).resolves.toEqual({
        success: true,
        unitId,
        movementLeft: 3,
        tiles: [
          { x: 5, y: 5, remainingMovement: 3 },
          { x: 6, y: 5, remainingMovement: 2 },
        ],
      });
      expect(findAccessibleTiles).toHaveBeenCalledWith(unit);
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

  describe('runtime player control transfer', () => {
    function installGame() {
      const processTurn = jest.fn().mockResolvedValue(undefined);
      const players = new Map<string, any>([
        [
          'host-player',
          {
            id: 'host-player',
            userId: 'test-host-id',
            isAI: false,
            isAlive: true,
            isConnected: true,
            hasEndedTurn: true,
            aiLevel: 'easy',
          },
        ],
        [
          'target-player',
          {
            id: 'target-player',
            userId: 'target-user',
            isAI: false,
            isAlive: true,
            isConnected: false,
            hasEndedTurn: false,
            aiLevel: 'normal',
            aiState: { stale: true },
          },
        ],
      ]);
      (gameManager as any).games.set('test-game-id', {
        id: 'test-game-id',
        state: 'active',
        config: { aiLevel: 'easy' },
        currentTurn: 7,
        players,
        turnManager: {
          processTurn,
          getCurrentTurn: jest.fn(() => 8),
        },
      });
      (gameManager as any).playerToGame.set('host-player', 'test-game-id');
      (gameManager as any).playerToGame.set('target-player', 'test-game-id');
      mockDb.query.games.findFirst.mockResolvedValue({
        id: 'test-game-id',
        hostId: 'test-host-id',
      });
      return { players, processTurn };
    }

    it('starts fresh native AI state and releases an outstanding human turn', async () => {
      const { players, processTurn } = installGame();

      await gameManager.setPlayerAIControl('test-game-id', 'test-host-id', 'target-player', true, {
        aiLevel: 'hard',
      });

      expect(players.get('target-player')).toMatchObject({
        isAI: true,
        aiLevel: 'hard',
        isConnected: false,
        hasEndedTurn: false,
        aiState: { diplomacy: {}, unitTasks: {}, cityWants: {}, techWants: {} },
      });
      expect(processTurn).toHaveBeenCalledTimes(1);
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          isAI: true,
          aiLevel: 'hard',
          connectionStatus: 'disconnected',
        })
      );
      expect(mockEmit).toHaveBeenCalledWith(
        'player-control-changed',
        expect.objectContaining({ playerId: 'target-player', isAI: true })
      );
    });

    it('returns an AI civilization to one human controller', async () => {
      const { players } = installGame();
      const target = players.get('target-player');
      target.isAI = true;
      target.userId = null;

      await gameManager.setPlayerAIControl('test-game-id', 'test-host-id', 'target-player', false, {
        controllerUserId: 'replacement-user',
      });

      expect(target).toMatchObject({
        isAI: false,
        userId: 'replacement-user',
        isConnected: false,
        hasEndedTurn: false,
      });
    });

    it('serializes control transfer behind an in-flight end-turn operation', async () => {
      const { players, processTurn } = installGame();
      let releaseTurn!: () => void;
      processTurn.mockImplementation(
        () =>
          new Promise<void>(resolve => {
            releaseTurn = resolve;
          })
      );

      const endTurn = gameManager.endTurn('target-player');
      while (!releaseTurn) await Promise.resolve();
      const transfer = gameManager.setPlayerAIControl(
        'test-game-id',
        'test-host-id',
        'target-player',
        true
      );
      await Promise.resolve();

      expect(players.get('target-player').isAI).toBe(false);
      releaseTurn();
      await Promise.all([endTurn, transfer]);

      expect(players.get('target-player').isAI).toBe(true);
      expect(processTurn).toHaveBeenCalledTimes(1);
    });

    it('rejects non-host transfers and duplicate human ownership', async () => {
      const { players } = installGame();
      players.get('target-player').isAI = true;
      players.get('target-player').userId = null;

      await expect(
        gameManager.setPlayerAIControl('test-game-id', 'not-host', 'target-player', true)
      ).rejects.toThrow('Only the host');
      await expect(
        gameManager.setPlayerAIControl('test-game-id', 'test-host-id', 'target-player', false, {
          controllerUserId: 'test-host-id',
        })
      ).rejects.toThrow('already owns another civilization');
    });
  });

  describe('shared advisor access', () => {
    it('returns advice only for the requesting human controller', async () => {
      const getRecommendations = jest.fn().mockResolvedValue({ playerId: 'human', turn: 2 });
      (gameManager as any).advisorService = { getRecommendations };
      const game = {
        id: 'test-game-id',
        players: new Map([
          ['human', { id: 'human', userId: 'test-user', isAI: false }],
          ['ai', { id: 'ai', userId: null, isAI: true }],
        ]),
      };
      (gameManager as any).games.set('test-game-id', game);

      await expect(
        gameManager.getAdvisorRecommendations('test-game-id', 'test-user')
      ).resolves.toEqual({ playerId: 'human', turn: 2 });
      expect(getRecommendations).toHaveBeenCalledWith(game, 'human');
      await expect(
        gameManager.getAdvisorRecommendations('test-game-id', 'spectator')
      ).rejects.toThrow('No human civilization');
    });
  });
});
