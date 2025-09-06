/**
 * Integration test for the complete nation selection flow
 * Tests both game creation and game joining with nation selection
 */

import { GameManagementHandler } from '@network/handlers/GameManagementHandler';
import { PacketHandler } from '@network/PacketHandler';
import { PacketType } from '@app-types/packet';
import { GameManager } from '@game/managers/GameManager';
import { Server, Socket } from 'socket.io';
import { getTestDatabaseProvider, clearAllTables } from '../utils/testDatabase';

// Mock logger to reduce noise
jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('Nation Selection Flow - Integration', () => {
  let gameManager: GameManager;
  let handler: GameManagementHandler;
  let mockPacketHandler: jest.Mocked<PacketHandler>;
  let mockSocket: jest.Mocked<Socket>;
  let mockIo: jest.Mocked<Server>;
  let activeConnections: Map<string, any>;

  const mockSocketId = 'test-socket-id';
  const mockUserId = 'test-user-id';
  const mockUsername = 'testuser';

  beforeEach(async () => {
    // Clear database before each test
    await clearAllTables();

    // Reset GameManager singleton for testing
    (GameManager as any).instance = null;

    // Create GameManager with test database provider
    const testDbProvider = getTestDatabaseProvider();
    gameManager = GameManager.getInstance({} as Server, testDbProvider);

    jest.clearAllMocks();

    // Create active connections map
    activeConnections = new Map();

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
    handler = new GameManagementHandler(activeConnections, gameManager);
    activeConnections.set(mockSocketId, { userId: mockUserId, username: mockUsername });
  });

  describe('Game Creation with Nation Selection', () => {
    it('should create game and assign specific nation to creator', async () => {
      // Arrange
      const gameData = {
        name: 'Integration Test Game',
        maxPlayers: 4,
        mapWidth: 50,
        mapHeight: 50,
        selectedNation: 'roman',
      };

      handler.register(mockPacketHandler, mockIo, mockSocket);

      // Get the registered handler function for GAME_CREATE
      const createHandler = (mockPacketHandler.register as jest.Mock).mock.calls.find(
        call => call[0] === PacketType.GAME_CREATE
      )[1];

      // Act
      await createHandler(mockSocket, gameData);

      // Assert
      expect(mockPacketHandler.send).toHaveBeenCalledWith(
        mockSocket,
        PacketType.GAME_CREATE_REPLY,
        expect.objectContaining({
          success: true,
          assignedNation: 'roman',
        })
      );

      // Verify socket event was emitted with assignedNation
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'game_created',
        expect.objectContaining({
          assignedNation: 'roman',
        })
      );
    });

    it('should create game and assign random nation when requested', async () => {
      // Arrange
      const gameData = {
        name: 'Random Test Game',
        maxPlayers: 4,
        mapWidth: 50,
        mapHeight: 50,
        selectedNation: 'random',
      };

      handler.register(mockPacketHandler, mockIo, mockSocket);
      const createHandler = (mockPacketHandler.register as jest.Mock).mock.calls.find(
        call => call[0] === PacketType.GAME_CREATE
      )[1];

      // Act
      await createHandler(mockSocket, gameData);

      // Assert - should assign a specific nation, not "random"
      const packetCall = (mockPacketHandler.send as jest.Mock).mock.calls[0];
      expect(packetCall[2].assignedNation).toBeDefined();
      expect(packetCall[2].assignedNation).not.toBe('random');

      const socketCall = (mockSocket.emit as jest.Mock).mock.calls.find(
        call => call[0] === 'game_created'
      );
      expect(socketCall[1].assignedNation).toBeDefined();
      expect(socketCall[1].assignedNation).not.toBe('random');

      // Both should be the same
      expect(packetCall[2].assignedNation).toBe(socketCall[1].assignedNation);
    });
  });

  describe('Game Joining with Nation Selection', () => {
    let testGameId: string;

    beforeEach(async () => {
      // Create a test game first
      const gameConfig = {
        name: 'Join Test Game',
        hostId: mockUserId,
        maxPlayers: 4,
        mapWidth: 50,
        mapHeight: 50,
      };
      testGameId = await gameManager.createGame(gameConfig);
    });

    it('should join game with specific nation selection', async () => {
      // Arrange
      const joinData = {
        gameId: testGameId,
        playerName: 'SecondPlayer',
        selectedNation: 'chinese',
      };

      const newUserId = 'second-user-id';
      const newSocketId = 'second-socket-id';
      const newMockSocket = {
        id: newSocketId,
        join: jest.fn(),
        on: jest.fn(),
        emit: jest.fn(),
        data: {},
      } as any;

      activeConnections.set(newSocketId, { userId: newUserId, username: 'SecondPlayer' });

      handler.register(mockPacketHandler, mockIo, newMockSocket);

      // Get the join_game event handler
      const joinHandler = (newMockSocket.on as jest.Mock).mock.calls.find(
        call => call[0] === 'join_game'
      )[1];

      const mockCallback = jest.fn();

      // Act
      await joinHandler(joinData, mockCallback);

      // Assert
      expect(mockCallback).toHaveBeenCalledWith({
        success: true,
        playerId: expect.any(String),
        assignedNation: 'chinese',
      });
    });

    it('should handle random nation selection for second player', async () => {
      // Arrange - first player joins with a specific nation
      await gameManager.joinGame(testGameId, 'first-user', 'american');

      const joinData = {
        gameId: testGameId,
        playerName: 'RandomPlayer',
        selectedNation: 'random',
      };

      const newUserId = 'random-user-id';
      const newSocketId = 'random-socket-id';
      const newMockSocket = {
        id: newSocketId,
        join: jest.fn(),
        on: jest.fn(),
        emit: jest.fn(),
        data: {},
      } as any;

      activeConnections.set(newSocketId, { userId: newUserId, username: 'RandomPlayer' });

      handler.register(mockPacketHandler, mockIo, newMockSocket);
      const joinHandler = (newMockSocket.on as jest.Mock).mock.calls.find(
        call => call[0] === 'join_game'
      )[1];

      const mockCallback = jest.fn();

      // Act
      await joinHandler(joinData, mockCallback);

      // Assert
      const response = mockCallback.mock.calls[0][0];
      expect(response.success).toBe(true);
      expect(response.assignedNation).toBeDefined();
      expect(response.assignedNation).not.toBe('random');
      expect(response.assignedNation).not.toBe('american'); // Should not be taken nation
    });
  });
});
