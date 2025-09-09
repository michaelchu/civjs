/**
 * Integration test for the complete nation selection flow
 * Tests both game creation and game joining with nation selection
 */

import { GameManagementHandler } from '@network/handlers/GameManagementHandler';
import { PacketHandler } from '@network/PacketHandler';
import { PacketType } from '@app-types/packet';
import { GameManager } from '@game/managers/GameManager';
import { Server, Socket } from 'socket.io';
import {
  getTestDatabaseProvider,
  clearAllTables,
  generateTestUUID,
  getTestDatabase,
} from '../utils/testDatabase';
import { createMockSocketServer } from '../utils/gameTestUtils';
import * as schema from '@database/schema';

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
  let mockIo: Server;
  let activeConnections: Map<string, any>;

  const mockSocketId = 'test-socket-id';
  const mockUserId = generateTestUUID('1001');
  const mockUsername = 'testuser';

  beforeEach(async () => {
    // Clear database before each test
    await clearAllTables();

    // Reset GameManager singleton for testing
    (GameManager as any).instance = null;

    // Create GameManager with properly mocked Socket.IO server
    mockIo = createMockSocketServer();
    const testDbProvider = getTestDatabaseProvider();
    gameManager = GameManager.getInstance(mockIo, testDbProvider);

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

    // Create handler
    handler = new GameManagementHandler(activeConnections, gameManager);
    activeConnections.set(mockSocketId, { userId: mockUserId, username: mockUsername });
  });

  describe('Game Creation with Nation Selection', () => {
    it('should create game and assign specific nation to creator', async () => {
      // Create user in database first
      const db = getTestDatabase();
      try {
        await db.insert(schema.users).values({
          id: mockUserId,
          username: `${mockUsername}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          email: `${mockUsername}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}@test.com`,
          passwordHash: 'test-hash',
        });
      } catch (error) {
        // Handle potential unique constraint violations
        const existing = await db.query.users.findFirst({
          where: (users, { eq }) => eq(users.id, mockUserId),
        });
        if (!existing) {
          throw new Error(`Failed to create test user: ${error}`);
        }
      }

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
      // Create user in database first
      const db = getTestDatabase();
      try {
        await db.insert(schema.users).values({
          id: mockUserId,
          username: `${mockUsername}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          email: `${mockUsername}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}@test.com`,
          passwordHash: 'test-hash',
        });
      } catch (error) {
        // Handle potential unique constraint violations
        const existing = await db.query.users.findFirst({
          where: (users, { eq }) => eq(users.id, mockUserId),
        });
        if (!existing) {
          throw new Error(`Failed to create test user: ${error}`);
        }
      }

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
      // Create user in database first
      const db = getTestDatabase();
      try {
        await db.insert(schema.users).values({
          id: mockUserId,
          username: `${mockUsername}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          email: `${mockUsername}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}@test.com`,
          passwordHash: 'test-hash',
        });
      } catch (error) {
        // Handle potential unique constraint violations
        const existing = await db.query.users.findFirst({
          where: (users, { eq }) => eq(users.id, mockUserId),
        });
        if (!existing) {
          throw new Error(`Failed to create test user: ${error}`);
        }
      }

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
      // Create second user in database first
      const newUserId = generateTestUUID('1002');
      const db = getTestDatabase();
      try {
        await db.insert(schema.users).values({
          id: newUserId,
          username: `SecondPlayer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          email: `secondplayer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}@test.com`,
          passwordHash: 'test-hash',
        });
      } catch (error) {
        const existing = await db.query.users.findFirst({
          where: (users, { eq }) => eq(users.id, newUserId),
        });
        if (!existing) {
          throw new Error(`Failed to create second test user: ${error}`);
        }
      }

      // Arrange
      const joinData = {
        gameId: testGameId,
        playerName: 'SecondPlayer',
        selectedNation: 'chinese',
      };
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
      // Create first user and join with specific nation
      const firstUserId = generateTestUUID('1003');
      const db = getTestDatabase();
      try {
        await db.insert(schema.users).values({
          id: firstUserId,
          username: `FirstPlayer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          email: `firstplayer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}@test.com`,
          passwordHash: 'test-hash',
        });
      } catch (error) {
        const existing = await db.query.users.findFirst({
          where: (users, { eq }) => eq(users.id, firstUserId),
        });
        if (!existing) {
          throw new Error(`Failed to create first test user: ${error}`);
        }
      }
      await gameManager.joinGame(testGameId, firstUserId, 'american');

      // Create second user for random nation selection
      const newUserId = generateTestUUID('1004');
      try {
        await db.insert(schema.users).values({
          id: newUserId,
          username: `RandomPlayer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          email: `randomplayer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}@test.com`,
          passwordHash: 'test-hash',
        });
      } catch (error) {
        const existing = await db.query.users.findFirst({
          where: (users, { eq }) => eq(users.id, newUserId),
        });
        if (!existing) {
          throw new Error(`Failed to create random test user: ${error}`);
        }
      }

      const joinData = {
        gameId: testGameId,
        playerName: 'RandomPlayer',
        selectedNation: 'random',
      };
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
