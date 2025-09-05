import { ConnectionHandler } from '@network/handlers/ConnectionHandler';
import { PacketHandler } from '@network/PacketHandler';
import { PacketType } from '@app-types/packet';
import { Server, Socket } from 'socket.io';
import { sessionCache } from '@database/redis';
import { db } from '@database';

// Mock dependencies
jest.mock('../../../src/database/redis');
jest.mock('../../../src/database');
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('ConnectionHandler', () => {
  let handler: ConnectionHandler;
  let mockPacketHandler: jest.Mocked<PacketHandler>;
  let mockSocket: jest.Mocked<Socket>;
  let mockIo: jest.Mocked<Server>;
  let activeConnections: Map<string, any>;

  const mockSocketId = 'test-socket-id';
  const mockUserId = 'test-user-id';
  const mockUsername = 'testuser';

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Create active connections map
    activeConnections = new Map();

    // Create handler
    handler = new ConnectionHandler(activeConnections);

    // Mock PacketHandler
    mockPacketHandler = {
      register: jest.fn(),
      send: jest.fn(),
      process: jest.fn(),
      broadcast: jest.fn(),
      cleanup: jest.fn(),
    } as any;

    // Mock Socket
    mockSocket = {
      id: mockSocketId,
      on: jest.fn(),
      join: jest.fn(),
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
      data: {},
    } as any;

    // Mock Server
    mockIo = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    } as any;

    // Mock database responses
    (db.query.users.findFirst as jest.Mock) = jest.fn();
    (db.update as jest.Mock) = jest.fn().mockReturnValue({
      set: jest.fn().mockReturnThis(),
      where: jest.fn(),
    });
    (db.insert as jest.Mock) = jest.fn().mockReturnValue({
      values: jest.fn().mockReturnThis(),
      returning: jest.fn().mockResolvedValue([{ id: mockUserId }]),
    });

    // Mock session cache
    (sessionCache.setSession as jest.Mock) = jest.fn().mockResolvedValue(undefined);
  });

  describe('register', () => {
    it('should register SERVER_JOIN_REQ handler and socket events', () => {
      handler.register(mockPacketHandler, mockIo, mockSocket);

      expect(mockPacketHandler.register).toHaveBeenCalledWith(
        PacketType.SERVER_JOIN_REQ,
        expect.any(Function),
        expect.any(Object)
      );

      expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('error', expect.any(Function));

      expect(activeConnections.has(mockSocketId)).toBe(true);
    });
  });

  describe('SERVER_JOIN_REQ handler', () => {
    beforeEach(() => {
      handler.register(mockPacketHandler, mockIo, mockSocket);
    });

    it('should authenticate existing user successfully', async () => {
      // Mock existing user
      (db.query.users.findFirst as jest.Mock).mockResolvedValue({
        id: mockUserId,
        username: mockUsername,
      });

      // Get the registered handler function
      const handlerFn = (mockPacketHandler.register as jest.Mock).mock.calls[0][1];

      // Call the handler
      await handlerFn(mockSocket, { username: mockUsername });

      expect(db.query.users.findFirst).toHaveBeenCalled();
      expect(mockSocket.join).toHaveBeenCalledWith(`player:${mockUserId}`);
      expect(sessionCache.setSession).toHaveBeenCalledWith(mockSocketId, mockUserId);

      expect(mockPacketHandler.send).toHaveBeenCalledWith(
        mockSocket,
        PacketType.SERVER_JOIN_REPLY,
        {
          accepted: true,
          playerId: mockUserId,
          message: 'Welcome back!',
          capability: 'civjs-1.0',
        }
      );

      expect(activeConnections.get(mockSocketId)).toEqual({
        userId: mockUserId,
        username: mockUsername,
      });
    });

    it('should create new user successfully', async () => {
      // Mock no existing user
      (db.query.users.findFirst as jest.Mock).mockResolvedValue(null);

      // Get the registered handler function
      const handlerFn = (mockPacketHandler.register as jest.Mock).mock.calls[0][1];

      // Call the handler
      await handlerFn(mockSocket, { username: mockUsername });

      expect(db.insert).toHaveBeenCalled();
      expect(mockSocket.join).toHaveBeenCalledWith(`player:${mockUserId}`);

      expect(mockPacketHandler.send).toHaveBeenCalledWith(
        mockSocket,
        PacketType.SERVER_JOIN_REPLY,
        {
          accepted: true,
          playerId: mockUserId,
          message: 'Welcome to CivJS!',
          capability: 'civjs-1.0',
        }
      );
    });

    it('should handle race condition when creating user', async () => {
      // Mock no existing user initially
      (db.query.users.findFirst as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: mockUserId, username: mockUsername });

      // Mock unique constraint violation
      const constraintError = new Error('Unique constraint violation');
      (constraintError as any).code = '23505';

      (db.insert as jest.Mock).mockReturnValue({
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockRejectedValue(constraintError),
      });

      // Get the registered handler function
      const handlerFn = (mockPacketHandler.register as jest.Mock).mock.calls[0][1];

      // Call the handler
      await handlerFn(mockSocket, { username: mockUsername });

      expect(db.query.users.findFirst).toHaveBeenCalledTimes(2);
      expect(mockPacketHandler.send).toHaveBeenCalledWith(
        mockSocket,
        PacketType.SERVER_JOIN_REPLY,
        expect.objectContaining({
          accepted: true,
          playerId: mockUserId,
        })
      );
    });

    it('should handle database errors gracefully', async () => {
      // Mock database error
      (db.query.users.findFirst as jest.Mock).mockRejectedValue(new Error('Database error'));

      // Get the registered handler function
      const handlerFn = (mockPacketHandler.register as jest.Mock).mock.calls[0][1];

      // Call the handler
      await handlerFn(mockSocket, { username: mockUsername });

      expect(mockPacketHandler.send).toHaveBeenCalledWith(
        mockSocket,
        PacketType.SERVER_JOIN_REPLY,
        {
          accepted: false,
          message: 'Failed to join server',
        }
      );
    });
  });

  describe('disconnect handling', () => {
    beforeEach(() => {
      handler.register(mockPacketHandler, mockIo, mockSocket);

      // Set up connection info
      activeConnections.set(mockSocketId, {
        userId: mockUserId,
        username: mockUsername,
        gameId: 'test-game-id',
      });
    });

    it('should handle disconnect and update last seen', async () => {
      // Get the disconnect handler
      const disconnectHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        call => call[0] === 'disconnect'
      )[1];

      await disconnectHandler();

      expect(db.update).toHaveBeenCalled();
      expect(mockSocket.to).toHaveBeenCalledWith('game:test-game-id');
    });
  });

  describe('utility methods', () => {
    beforeEach(() => {
      activeConnections.set(mockSocketId, {
        userId: mockUserId,
        username: mockUsername,
        gameId: 'test-game-id',
      });
    });

    it('should get connection info', () => {
      const info = handler.getConnectionInfo(mockSocketId);
      expect(info).toEqual({
        userId: mockUserId,
        username: mockUsername,
        gameId: 'test-game-id',
      });
    });

    it('should update connection info', () => {
      handler.updateConnection(mockSocketId, { gameId: 'new-game-id' });

      const info = handler.getConnectionInfo(mockSocketId);
      expect(info?.gameId).toBe('new-game-id');
    });

    it('should return handled packet types', () => {
      const types = handler.getHandledPacketTypes();
      expect(types).toContain(PacketType.SERVER_JOIN_REQ);
    });

    it('should return handler name', () => {
      expect(handler.getName()).toBe('ConnectionHandler');
    });
  });

  describe('cleanup', () => {
    it('should remove connection from active connections', () => {
      activeConnections.set(mockSocketId, { userId: mockUserId });

      handler.cleanup(mockSocketId);

      expect(activeConnections.has(mockSocketId)).toBe(false);
    });
  });
});
