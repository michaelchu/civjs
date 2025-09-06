import { GameManagementHandler } from '@network/handlers/GameManagementHandler';
import { PacketHandler } from '@network/PacketHandler';
import { PacketType } from '@app-types/packet';
import { GameManager } from '@game/managers/GameManager';
import { Server, Socket } from 'socket.io';

// Mock dependencies
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('GameManagementHandler - Nation Selection', () => {
  let handler: GameManagementHandler;
  let mockPacketHandler: jest.Mocked<PacketHandler>;
  let mockSocket: jest.Mocked<Socket>;
  let mockIo: jest.Mocked<Server>;
  let mockGameManager: jest.Mocked<GameManager>;
  let activeConnections: Map<string, any>;

  const mockSocketId = 'test-socket-id';
  const mockUserId = 'test-user-id';
  const mockUsername = 'testuser';
  const mockGameId = 'test-game-id';
  const mockPlayerId = 'test-player-id';

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create active connections map
    activeConnections = new Map();

    // Mock GameManager
    mockGameManager = {
      createGame: jest.fn(),
      joinGame: jest.fn(),
      startGame: jest.fn(),
      getGame: jest.fn(),
      getGameListForLobby: jest.fn(),
      deleteGame: jest.fn(),
      updatePlayerConnection: jest.fn(),
      getPlayerById: jest.fn(),
    } as any;

    // Mock PacketHandler
    mockPacketHandler = {
      register: jest.fn(),
      send: jest.fn(),
    } as any;

    // Mock Socket
    mockSocket = {
      id: mockSocketId,
      join: jest.fn(),
      on: jest.fn(),
      emit: jest.fn(),
      data: {},
    } as any;

    // Mock Server
    mockIo = {} as any;

    // Create handler
    handler = new GameManagementHandler(activeConnections, mockGameManager);
  });

  describe('GAME_CREATE with nation selection', () => {
    beforeEach(() => {
      handler.register(mockPacketHandler, mockIo, mockSocket);
      activeConnections.set(mockSocketId, { userId: mockUserId, username: mockUsername });
    });

    it('should pass selectedNation to joinGame when creating game', async () => {
      // Arrange
      const gameData = {
        name: 'New Game',
        maxPlayers: 4,
        mapWidth: 50,
        mapHeight: 50,
        selectedNation: 'american',
      };

      mockGameManager.createGame.mockResolvedValue(mockGameId);
      mockGameManager.joinGame.mockResolvedValue(mockPlayerId);
      mockGameManager.getPlayerById.mockResolvedValue({
        nation: 'american',
        civilization: 'american',
      });

      // Get the registered handler function for GAME_CREATE
      const handlerFn = (mockPacketHandler.register as jest.Mock).mock.calls.find(
        call => call[0] === PacketType.GAME_CREATE
      )[1];

      // Act
      await handlerFn(mockSocket, gameData);

      // Assert - verify joinGame was called with selectedNation
      expect(mockGameManager.joinGame).toHaveBeenCalledWith(mockGameId, mockUserId, 'american');

      // Verify response includes assignedNation
      expect(mockPacketHandler.send).toHaveBeenCalledWith(
        mockSocket,
        PacketType.GAME_CREATE_REPLY,
        {
          success: true,
          gameId: mockGameId,
          message: 'Game created successfully',
          assignedNation: 'american',
        }
      );
    });

    it('should handle random nation selection during game creation', async () => {
      // Arrange
      const gameData = {
        name: 'New Game',
        maxPlayers: 4,
        mapWidth: 50,
        mapHeight: 50,
        selectedNation: 'random',
      };

      mockGameManager.createGame.mockResolvedValue(mockGameId);
      mockGameManager.joinGame.mockResolvedValue(mockPlayerId);
      // Mock that server assigned a random nation
      mockGameManager.getPlayerById.mockResolvedValue({
        nation: 'chinese',
        civilization: 'chinese',
      });

      const handlerFn = (mockPacketHandler.register as jest.Mock).mock.calls.find(
        call => call[0] === PacketType.GAME_CREATE
      )[1];

      // Act
      await handlerFn(mockSocket, gameData);

      // Assert - verify joinGame was called with 'random'
      expect(mockGameManager.joinGame).toHaveBeenCalledWith(mockGameId, mockUserId, 'random');

      // Verify response includes the actually assigned nation
      expect(mockPacketHandler.send).toHaveBeenCalledWith(
        mockSocket,
        PacketType.GAME_CREATE_REPLY,
        {
          success: true,
          gameId: mockGameId,
          message: 'Game created successfully',
          assignedNation: 'chinese', // Server assigned this
        }
      );
    });

    it('should fallback to random when selectedNation not provided', async () => {
      // Arrange
      const gameData = {
        name: 'New Game',
        maxPlayers: 4,
        mapWidth: 50,
        mapHeight: 50,
        // No selectedNation provided
      };

      mockGameManager.createGame.mockResolvedValue(mockGameId);
      mockGameManager.joinGame.mockResolvedValue(mockPlayerId);
      mockGameManager.getPlayerById.mockResolvedValue({
        nation: 'roman',
        civilization: 'roman',
      });

      const handlerFn = (mockPacketHandler.register as jest.Mock).mock.calls.find(
        call => call[0] === PacketType.GAME_CREATE
      )[1];

      // Act
      await handlerFn(mockSocket, gameData);

      // Assert - should use undefined selectedNation, GameManager should handle this
      expect(mockGameManager.joinGame).toHaveBeenCalledWith(
        mockGameId,
        mockUserId,
        undefined // No selectedNation provided
      );
    });
  });

  describe('join_game socket event with nation selection', () => {
    beforeEach(() => {
      handler.register(mockPacketHandler, mockIo, mockSocket);
      activeConnections.set(mockSocketId, { userId: mockUserId, username: mockUsername });
    });

    it('should pass selectedNation to joinGame when joining existing game', async () => {
      // Arrange
      const joinData = {
        gameId: mockGameId,
        playerName: mockUsername,
        selectedNation: 'german',
      };

      mockGameManager.joinGame.mockResolvedValue(mockPlayerId);
      mockGameManager.getPlayerById.mockResolvedValue({
        nation: 'german',
        civilization: 'german',
      });

      // Get the join_game event handler
      const eventHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        call => call[0] === 'join_game'
      )[1];

      const mockCallback = jest.fn();

      // Act
      await eventHandler(joinData, mockCallback);

      // Assert
      expect(mockGameManager.joinGame).toHaveBeenCalledWith(mockGameId, mockUserId, 'german');

      expect(mockCallback).toHaveBeenCalledWith({
        success: true,
        playerId: mockPlayerId,
        assignedNation: 'german',
      });
    });

    it('should default to random when selectedNation not provided in join', async () => {
      // Arrange
      const joinData = {
        gameId: mockGameId,
        playerName: mockUsername,
        // No selectedNation
      };

      mockGameManager.joinGame.mockResolvedValue(mockPlayerId);
      mockGameManager.getPlayerById.mockResolvedValue({
        nation: 'french',
        civilization: 'french',
      });

      const eventHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        call => call[0] === 'join_game'
      )[1];

      const mockCallback = jest.fn();

      // Act
      await eventHandler(joinData, mockCallback);

      // Assert - should default to 'random'
      expect(mockGameManager.joinGame).toHaveBeenCalledWith(
        mockGameId,
        mockUserId,
        'random' // Default fallback
      );

      expect(mockCallback).toHaveBeenCalledWith({
        success: true,
        playerId: mockPlayerId,
        assignedNation: 'french',
      });
    });

    it('should handle random nation assignment correctly', async () => {
      // Arrange
      const joinData = {
        gameId: mockGameId,
        playerName: mockUsername,
        selectedNation: 'random',
      };

      mockGameManager.joinGame.mockResolvedValue(mockPlayerId);
      // Mock that server randomly assigned a nation
      mockGameManager.getPlayerById.mockResolvedValue({
        nation: 'japanese',
        civilization: 'japanese',
      });

      const eventHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        call => call[0] === 'join_game'
      )[1];

      const mockCallback = jest.fn();

      // Act
      await eventHandler(joinData, mockCallback);

      // Assert
      expect(mockGameManager.joinGame).toHaveBeenCalledWith(mockGameId, mockUserId, 'random');

      expect(mockCallback).toHaveBeenCalledWith({
        success: true,
        playerId: mockPlayerId,
        assignedNation: 'japanese', // Randomly assigned by server
      });
    });

    it('should handle case where getPlayerById returns null', async () => {
      // Arrange
      const joinData = {
        gameId: mockGameId,
        playerName: mockUsername,
        selectedNation: 'viking',
      };

      mockGameManager.joinGame.mockResolvedValue(mockPlayerId);
      mockGameManager.getPlayerById.mockResolvedValue(null); // Player not found

      const eventHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        call => call[0] === 'join_game'
      )[1];

      const mockCallback = jest.fn();

      // Act
      await eventHandler(joinData, mockCallback);

      // Assert - should fallback to selected nation
      expect(mockCallback).toHaveBeenCalledWith({
        success: true,
        playerId: mockPlayerId,
        assignedNation: 'viking', // Fallback to selectedNation
      });
    });

    it('should handle case where player data has no nation field', async () => {
      // Arrange
      const joinData = {
        gameId: mockGameId,
        playerName: mockUsername,
        selectedNation: 'egyptian',
      };

      mockGameManager.joinGame.mockResolvedValue(mockPlayerId);
      mockGameManager.getPlayerById.mockResolvedValue({}); // Player data without nation

      const eventHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        call => call[0] === 'join_game'
      )[1];

      const mockCallback = jest.fn();

      // Act
      await eventHandler(joinData, mockCallback);

      // Assert - should fallback to selectedNation
      expect(mockCallback).toHaveBeenCalledWith({
        success: true,
        playerId: mockPlayerId,
        assignedNation: 'egyptian', // Fallback to selectedNation
      });
    });
  });
});
