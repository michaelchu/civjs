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

describe('GameManagementHandler', () => {
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

    // Create handler
    handler = new GameManagementHandler(activeConnections, mockGameManager);

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
      emit: jest.fn(),
      data: {},
    } as any;

    // Mock Server
    mockIo = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    } as any;
  });

  describe('register', () => {
    it('should register all game management packet handlers', () => {
      handler.register(mockPacketHandler, mockIo, mockSocket);

      expect(mockPacketHandler.register).toHaveBeenCalledWith(
        PacketType.GAME_LIST,
        expect.any(Function)
      );
      expect(mockPacketHandler.register).toHaveBeenCalledWith(
        PacketType.GAME_CREATE,
        expect.any(Function)
      );
      expect(mockPacketHandler.register).toHaveBeenCalledWith(
        PacketType.GAME_JOIN,
        expect.any(Function)
      );
      expect(mockPacketHandler.register).toHaveBeenCalledWith(
        PacketType.GAME_START,
        expect.any(Function)
      );

      expect(mockSocket.on).toHaveBeenCalledWith('join_game', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('observe_game', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('get_game_list', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('delete_game', expect.any(Function));
    });
  });

  describe('GAME_LIST handler', () => {
    beforeEach(() => {
      handler.register(mockPacketHandler, mockIo, mockSocket);
      activeConnections.set(mockSocketId, { userId: mockUserId, username: mockUsername });
    });

    it('should fetch and emit game list', async () => {
      const mockGames = [
        {
          id: mockGameId,
          name: 'Test Game',
          status: 'waiting',
          currentPlayers: 1,
          maxPlayers: 2,
          currentTurn: 1,
          mapSize: 'small',
        },
      ];

      mockGameManager.getGameListForLobby.mockResolvedValue(mockGames as any);

      // Get the registered handler function for GAME_LIST
      const handlerFn = (mockPacketHandler.register as jest.Mock).mock.calls.find(
        call => call[0] === PacketType.GAME_LIST
      )[1];

      await handlerFn(mockSocket);

      expect(mockGameManager.getGameListForLobby).toHaveBeenCalledWith(mockUserId);
      expect(mockSocket.emit).toHaveBeenCalledWith('packet', {
        type: PacketType.GAME_LIST,
        data: {
          games: expect.arrayContaining([
            expect.objectContaining({
              gameId: mockGameId,
              name: 'Test Game',
              status: 'waiting',
            }),
          ]),
        },
      });
    });
  });

  describe('GAME_CREATE handler', () => {
    beforeEach(() => {
      handler.register(mockPacketHandler, mockIo, mockSocket);
      activeConnections.set(mockSocketId, { userId: mockUserId, username: mockUsername });
    });

    it('should create game successfully for authenticated user', async () => {
      const gameData = {
        name: 'New Game',
        maxPlayers: 4,
        mapWidth: 50,
        mapHeight: 50,
        selectedNation: 'romans',
      };

      mockGameManager.createGame.mockResolvedValue(mockGameId);
      mockGameManager.joinGame.mockResolvedValue(mockPlayerId);
      mockGameManager.getPlayerById.mockResolvedValue({ nation: 'romans' });

      // Get the registered handler function for GAME_CREATE
      const handlerFn = (mockPacketHandler.register as jest.Mock).mock.calls.find(
        call => call[0] === PacketType.GAME_CREATE
      )[1];

      await handlerFn(mockSocket, gameData);

      expect(mockGameManager.createGame).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New Game',
          hostId: mockUserId,
          maxPlayers: 4,
        })
      );

      expect(mockSocket.join).toHaveBeenCalledWith(`game:${mockGameId}`);
      expect(mockGameManager.joinGame).toHaveBeenCalledWith(mockGameId, mockUserId, 'romans');

      expect(mockPacketHandler.send).toHaveBeenCalledWith(
        mockSocket,
        PacketType.GAME_CREATE_REPLY,
        {
          success: true,
          gameId: mockGameId,
          message: 'Game created successfully',
          assignedNation: 'romans',
        }
      );
    });

    it('should reject unauthenticated user', async () => {
      // Remove authentication
      activeConnections.set(mockSocketId, {});

      const handlerFn = (mockPacketHandler.register as jest.Mock).mock.calls.find(
        call => call[0] === PacketType.GAME_CREATE
      )[1];

      await handlerFn(mockSocket, {});

      expect(mockPacketHandler.send).toHaveBeenCalledWith(
        mockSocket,
        PacketType.GAME_CREATE_REPLY,
        {
          success: false,
          message: 'Not authenticated',
        }
      );
    });

    it('should handle game creation error', async () => {
      mockGameManager.createGame.mockRejectedValue(new Error('Game creation failed'));

      const handlerFn = (mockPacketHandler.register as jest.Mock).mock.calls.find(
        call => call[0] === PacketType.GAME_CREATE
      )[1];

      await handlerFn(mockSocket, { name: 'Test Game' });

      expect(mockPacketHandler.send).toHaveBeenCalledWith(
        mockSocket,
        PacketType.GAME_CREATE_REPLY,
        {
          success: false,
          message: 'Game creation failed',
        }
      );
    });
  });

  describe('GAME_JOIN handler', () => {
    beforeEach(() => {
      handler.register(mockPacketHandler, mockIo, mockSocket);
      activeConnections.set(mockSocketId, { userId: mockUserId, username: mockUsername });
    });

    it('should join game successfully', async () => {
      const joinData = { gameId: mockGameId, civilization: 'greeks' };
      mockGameManager.joinGame.mockResolvedValue(mockPlayerId);

      const handlerFn = (mockPacketHandler.register as jest.Mock).mock.calls.find(
        call => call[0] === PacketType.GAME_JOIN
      )[1];

      await handlerFn(mockSocket, joinData);

      expect(mockGameManager.joinGame).toHaveBeenCalledWith(mockGameId, mockUserId, 'greeks');
      expect(mockSocket.join).toHaveBeenCalledWith(`game:${mockGameId}`);
      expect(mockGameManager.updatePlayerConnection).toHaveBeenCalledWith(mockPlayerId, true);

      expect(mockPacketHandler.send).toHaveBeenCalledWith(mockSocket, PacketType.GAME_JOIN_REPLY, {
        success: true,
        playerId: mockPlayerId,
        message: 'Joined game successfully',
      });
    });
  });

  describe('join_game socket event', () => {
    beforeEach(() => {
      handler.register(mockPacketHandler, mockIo, mockSocket);
      activeConnections.set(mockSocketId, { userId: mockUserId, username: mockUsername });
    });

    it('should handle join_game event successfully', async () => {
      mockGameManager.joinGame.mockResolvedValue(mockPlayerId);
      mockGameManager.getPlayerById.mockResolvedValue({ nation: 'random' });

      // Get the join_game event handler
      const eventHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        call => call[0] === 'join_game'
      )[1];

      const mockCallback = jest.fn();
      await eventHandler({ gameId: mockGameId }, mockCallback);

      expect(mockGameManager.joinGame).toHaveBeenCalledWith(mockGameId, mockUserId, 'random');
      expect(mockCallback).toHaveBeenCalledWith({
        success: true,
        playerId: mockPlayerId,
        assignedNation: 'american',
      });
    });

    it('should handle authentication error', async () => {
      activeConnections.set(mockSocketId, {}); // No userId

      const eventHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        call => call[0] === 'join_game'
      )[1];

      const mockCallback = jest.fn();
      await eventHandler({ gameId: mockGameId }, mockCallback);

      expect(mockCallback).toHaveBeenCalledWith({
        success: false,
        error: 'Not authenticated',
      });
    });
  });

  describe('get_game_list socket event', () => {
    beforeEach(() => {
      handler.register(mockPacketHandler, mockIo, mockSocket);
    });

    it('should return game list', async () => {
      const mockGames = [{ id: mockGameId, name: 'Test Game' }];
      mockGameManager.getGameListForLobby.mockResolvedValue(mockGames as any);

      const eventHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        call => call[0] === 'get_game_list'
      )[1];

      const mockCallback = jest.fn();
      await eventHandler(mockCallback);

      expect(mockGameManager.getGameListForLobby).toHaveBeenCalledWith(null);
      expect(mockCallback).toHaveBeenCalledWith({
        success: true,
        games: mockGames,
      });
    });
  });

  describe('utility methods', () => {
    it('should return handled packet types', () => {
      const types = handler.getHandledPacketTypes();
      expect(types).toContain(PacketType.GAME_CREATE);
      expect(types).toContain(PacketType.GAME_JOIN);
      expect(types).toContain(PacketType.GAME_LIST);
      expect(types).toContain(PacketType.GAME_START);
    });

    it('should return handler name', () => {
      expect(handler.getName()).toBe('GameManagementHandler');
    });
  });
});
