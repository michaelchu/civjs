import { SocketCoordinator, setupSocketHandlers } from '@network/SocketCoordinator';
import { GameManager } from '@game/managers/GameManager';
import { Server, Socket } from 'socket.io';
import { PacketType, PROTOCOL_VERSION } from '@app-types/packet';

// Mock dependencies
jest.mock('../../src/utils/logger', () => {
  const mockLogger = {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  };
  return {
    logger: mockLogger,
    default: mockLogger,
  };
});

jest.mock('../../src/network/PacketHandler', () => {
  return {
    PacketHandler: jest.fn().mockImplementation(() => ({
      register: jest.fn(),
      send: jest.fn(),
      process: jest.fn(),
      broadcast: jest.fn(),
      cleanup: jest.fn(),
    })),
  };
});

jest.mock('@game/managers/GameManager');

describe('SocketCoordinator', () => {
  let coordinator: SocketCoordinator;
  let mockGameManager: jest.Mocked<GameManager>;
  let mockSocket: jest.Mocked<Socket>;
  let mockIo: jest.Mocked<Server>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock GameManager
    mockGameManager = {
      getGame: jest.fn(),
      updatePlayerConnection: jest.fn(),
    } as any;

    coordinator = new SocketCoordinator(mockGameManager);

    // Mock Socket
    mockSocket = {
      id: 'test-socket-id',
      on: jest.fn(),
      emit: jest.fn(),
      data: {},
    } as any;

    // Mock Server
    mockIo = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    } as any;
  });

  describe('initialization', () => {
    it('should initialize with all handlers', () => {
      const stats = coordinator.getHandlerStats();

      expect(stats).toHaveLength(12);
      expect(stats.map(s => s.name)).toContain('ConnectionHandler');
      expect(stats.map(s => s.name)).toContain('GameManagementHandler');
      expect(stats.map(s => s.name)).toContain('UnitActionHandler');
      expect(stats.map(s => s.name)).toContain('DiplomacyHandler');
      expect(stats.map(s => s.name)).toContain('GovernmentHandler');
      expect(stats.map(s => s.name)).toContain('EconomicHandler');
      expect(stats.map(s => s.name)).toContain('CityManagementHandler');
      expect(stats.map(s => s.name)).toContain('ResearchHandler');
      expect(stats.map(s => s.name)).toContain('MapVisibilityHandler');
      expect(stats.map(s => s.name)).toContain('ChatCommunicationHandler');
      expect(stats.map(s => s.name)).toContain('TurnManagementHandler');
      expect(stats.map(s => s.name)).toContain('SpaceshipHandler');
    });

    it('should provide handler statistics with packet types', () => {
      const stats = coordinator.getHandlerStats();

      // ConnectionHandler should handle SERVER_JOIN_REQ
      const connectionHandler = stats.find(s => s.name === 'ConnectionHandler');
      expect(connectionHandler?.packetTypes).toContain(PacketType.SERVER_JOIN_REQ);

      // UnitActionHandler should handle unit packets
      const unitHandler = stats.find(s => s.name === 'UnitActionHandler');
      expect(unitHandler?.packetTypes).toContain(PacketType.UNIT_MOVE);
      expect(unitHandler?.packetTypes).toContain(PacketType.UNIT_ATTACK);
    });
  });

  describe('socket setup', () => {
    it('should setup socket with all handlers', () => {
      coordinator.setupSocket(mockIo, mockSocket);

      // Should register packet handler and disconnect handler
      expect(mockSocket.on).toHaveBeenCalledWith('packet', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));

      // Should store packet handler on socket
      expect(mockSocket.data.packetHandler).toBeDefined();
    });

    it('should track active connections', () => {
      coordinator.setupSocket(mockIo, mockSocket);

      expect(coordinator.getActiveConnectionsCount()).toBe(1);
    });

    it('rejects spectator mutation packets before they reach gameplay handlers', async () => {
      coordinator.setupSocket(mockIo, mockSocket);
      Object.assign(coordinator.getConnectionInfo(mockSocket.id)!, {
        role: 'spectator',
        gameId: 'game-1',
      });
      const packetHandler = mockSocket.data.packetHandler;
      const packetListener = (mockSocket.on as jest.Mock).mock.calls.find(
        call => call[0] === 'packet'
      )![1];

      await packetListener({ type: PacketType.END_TURN, data: {} });

      expect(packetHandler.process).not.toHaveBeenCalled();
      expect(mockSocket.emit).toHaveBeenCalledWith('packet', {
        type: PacketType.SERVER_MESSAGE,
        version: PROTOCOL_VERSION,
        data: { type: 'error', message: 'Spectators cannot change game state' },
      });
    });
  });

  describe('connection management', () => {
    it('should provide connection info', () => {
      coordinator.setupSocket(mockIo, mockSocket);

      const info = coordinator.getConnectionInfo('test-socket-id');
      expect(info).toBeDefined();
    });

    it('should handle disconnect cleanup', async () => {
      coordinator.setupSocket(mockIo, mockSocket);

      // Make sure the socket has the packet handler with cleanup method
      const mockPacketHandler = {
        cleanup: jest.fn(),
      };
      mockSocket.data = {
        packetHandler: mockPacketHandler,
      };

      // Simulate disconnect
      const disconnectHandlers = (mockSocket.on as jest.Mock).mock.calls.filter(
        call => call[0] === 'disconnect'
      );
      const disconnectHandler = disconnectHandlers.at(-1)![1];

      await disconnectHandler();

      // Should clean up connection
      expect(coordinator.getActiveConnectionsCount()).toBe(0);
    });

    it('marks the game player disconnected before cleaning up connection context', async () => {
      coordinator.setupSocket(mockIo, mockSocket);
      Object.assign(coordinator.getConnectionInfo(mockSocket.id)!, {
        userId: 'user-1',
        gameId: 'game-1',
        role: 'player',
      });
      mockGameManager.getGame.mockResolvedValue({
        players: [{ id: 'player-1', userId: 'user-1' }],
      } as any);

      const disconnectHandler = (mockSocket.on as jest.Mock).mock.calls
        .filter(call => call[0] === 'disconnect')
        .at(-1)![1];
      await disconnectHandler();

      expect(mockGameManager.updatePlayerConnection).toHaveBeenCalledWith('player-1', false);
      expect(coordinator.getConnectionInfo(mockSocket.id)).toBeUndefined();
    });
  });
});

describe('setupSocketHandlers', () => {
  let mockSocket: jest.Mocked<Socket>;
  let mockIo: jest.Mocked<Server>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock GameManager.getInstance
    (GameManager.getInstance as jest.Mock).mockReturnValue({
      getGame: jest.fn(),
      updatePlayerConnection: jest.fn(),
    } as any);

    mockSocket = {
      id: 'test-socket-id',
      on: jest.fn(),
      data: {},
    } as any;

    mockIo = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    } as any;
  });

  it('should setup socket handlers using coordinator', () => {
    setupSocketHandlers(mockIo, mockSocket);

    expect(mockSocket.on).toHaveBeenCalledWith('packet', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
    expect(GameManager.getInstance).toHaveBeenCalledWith(mockIo);
  });
});
