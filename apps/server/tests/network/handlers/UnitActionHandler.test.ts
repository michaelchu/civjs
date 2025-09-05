import { UnitActionHandler } from '../../../src/network/handlers/UnitActionHandler';
import { PacketHandler } from '../../../src/network/PacketHandler';
import { PacketType } from '../../../src/types/packet';
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

describe('UnitActionHandler', () => {
  let handler: UnitActionHandler;
  let mockPacketHandler: jest.Mocked<PacketHandler>;
  let mockSocket: jest.Mocked<Socket>;
  let mockIo: jest.Mocked<Server>;
  let mockGameManager: jest.Mocked<GameManager>;
  let activeConnections: Map<string, any>;

  const mockSocketId = 'test-socket-id';
  const mockUserId = 'test-user-id';
  const mockGameId = 'test-game-id';
  const mockPlayerId = 'test-player-id';
  const mockUnitId = 'test-unit-id';

  beforeEach(() => {
    jest.clearAllMocks();

    activeConnections = new Map();
    mockGameManager = {
      getGame: jest.fn(),
      moveUnit: jest.fn(),
      attackUnit: jest.fn(),
      fortifyUnit: jest.fn(),
      createUnit: jest.fn(),
      requestPath: jest.fn(),
      getGameInstance: jest.fn(),
    } as any;

    handler = new UnitActionHandler(activeConnections, mockGameManager);

    mockPacketHandler = {
      register: jest.fn(),
      send: jest.fn(),
      process: jest.fn(),
      broadcast: jest.fn(),
      cleanup: jest.fn(),
    } as any;

    mockSocket = {
      id: mockSocketId,
      on: jest.fn(),
      emit: jest.fn(),
      data: {},
    } as any;

    mockIo = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    } as any;
  });

  describe('register', () => {
    it('should register all unit action packet handlers', () => {
      handler.register(mockPacketHandler, mockIo, mockSocket);

      expect(mockPacketHandler.register).toHaveBeenCalledWith(
        PacketType.UNIT_MOVE,
        expect.any(Function),
        expect.any(Object)
      );
      expect(mockPacketHandler.register).toHaveBeenCalledWith(
        PacketType.UNIT_ATTACK,
        expect.any(Function),
        expect.any(Object)
      );
      expect(mockPacketHandler.register).toHaveBeenCalledWith(
        PacketType.UNIT_FORTIFY,
        expect.any(Function),
        expect.any(Object)
      );
      expect(mockPacketHandler.register).toHaveBeenCalledWith(
        PacketType.UNIT_CREATE,
        expect.any(Function),
        expect.any(Object)
      );

      expect(mockSocket.on).toHaveBeenCalledWith('unit_action', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('path_request', expect.any(Function));
    });
  });

  describe('UNIT_MOVE handler', () => {
    beforeEach(() => {
      handler.register(mockPacketHandler, mockIo, mockSocket);
      activeConnections.set(mockSocketId, {
        userId: mockUserId,
        gameId: mockGameId,
      });
    });

    it('should move unit successfully', async () => {
      const mockGame = {
        state: 'active',
        players: new Map([[mockPlayerId, { id: mockPlayerId, userId: mockUserId }]]),
      };
      const mockGameInstance = {
        unitManager: {
          getUnit: jest.fn().mockReturnValue({
            x: 5,
            y: 5,
            movementLeft: 2,
          }),
        },
      };

      mockGameManager.getGame.mockResolvedValue(mockGame as any);
      mockGameManager.moveUnit.mockResolvedValue(true);
      mockGameManager.getGameInstance.mockReturnValue(mockGameInstance as any);

      const handlerFn = (mockPacketHandler.register as jest.Mock).mock.calls.find(
        call => call[0] === PacketType.UNIT_MOVE
      )[1];

      await handlerFn(mockSocket, {
        unitId: mockUnitId,
        x: 5,
        y: 5,
      });

      expect(mockGameManager.moveUnit).toHaveBeenCalledWith(
        mockGameId,
        mockPlayerId,
        mockUnitId,
        5,
        5
      );

      expect(mockPacketHandler.send).toHaveBeenCalledWith(mockSocket, PacketType.UNIT_MOVE_REPLY, {
        success: true,
        unitId: mockUnitId,
        newX: 5,
        newY: 5,
        movementLeft: 2,
      });
    });

    it('should reject unauthenticated user', async () => {
      activeConnections.set(mockSocketId, {}); // No userId

      const handlerFn = (mockPacketHandler.register as jest.Mock).mock.calls.find(
        call => call[0] === PacketType.UNIT_MOVE
      )[1];

      await handlerFn(mockSocket, { unitId: mockUnitId });

      expect(mockPacketHandler.send).toHaveBeenCalledWith(mockSocket, PacketType.UNIT_MOVE_REPLY, {
        success: false,
        unitId: mockUnitId,
        message: 'Not authenticated or not in a game',
      });
    });

    it('should handle inactive game', async () => {
      const mockGame = { state: 'waiting' };
      mockGameManager.getGame.mockResolvedValue(mockGame as any);

      const handlerFn = (mockPacketHandler.register as jest.Mock).mock.calls.find(
        call => call[0] === PacketType.UNIT_MOVE
      )[1];

      await handlerFn(mockSocket, { unitId: mockUnitId });

      expect(mockPacketHandler.send).toHaveBeenCalledWith(mockSocket, PacketType.UNIT_MOVE_REPLY, {
        success: false,
        unitId: mockUnitId,
        message: 'Game is not active',
      });
    });
  });

  describe('UNIT_ATTACK handler', () => {
    beforeEach(() => {
      handler.register(mockPacketHandler, mockIo, mockSocket);
      activeConnections.set(mockSocketId, {
        userId: mockUserId,
        gameId: mockGameId,
      });
    });

    it('should attack unit successfully', async () => {
      const mockGame = {
        state: 'active',
        players: new Map([[mockPlayerId, { id: mockPlayerId, userId: mockUserId }]]),
      };
      const mockCombatResult = {
        attackerId: mockUnitId,
        defenderId: 'defender-unit-id',
        attackerDamage: 10,
        defenderDamage: 5,
        attackerDestroyed: false,
        defenderDestroyed: false,
      };

      mockGameManager.getGame.mockResolvedValue(mockGame as any);
      mockGameManager.attackUnit.mockResolvedValue(mockCombatResult);

      const handlerFn = (mockPacketHandler.register as jest.Mock).mock.calls.find(
        call => call[0] === PacketType.UNIT_ATTACK
      )[1];

      await handlerFn(mockSocket, {
        attackerUnitId: mockUnitId,
        defenderUnitId: 'defender-unit-id',
      });

      expect(mockGameManager.attackUnit).toHaveBeenCalledWith(
        mockGameId,
        mockPlayerId,
        mockUnitId,
        'defender-unit-id'
      );

      expect(mockPacketHandler.send).toHaveBeenCalledWith(
        mockSocket,
        PacketType.UNIT_ATTACK_REPLY,
        {
          success: true,
          combatResult: mockCombatResult,
        }
      );
    });
  });

  describe('path_request socket event', () => {
    beforeEach(() => {
      handler.register(mockPacketHandler, mockIo, mockSocket);
      activeConnections.set(mockSocketId, {
        userId: mockUserId,
        gameId: mockGameId,
      });
    });

    it('should process path request successfully', async () => {
      const mockGameInstance = {
        players: new Map([[mockPlayerId, { userId: mockUserId }]]),
      };
      const mockPathResult = {
        success: true,
        path: [
          [1, 1],
          [2, 2],
        ],
      };

      mockGameManager.getGameInstance.mockReturnValue(mockGameInstance as any);
      mockGameManager.requestPath.mockResolvedValue(mockPathResult);

      const eventHandler = (mockSocket.on as jest.Mock).mock.calls.find(
        call => call[0] === 'path_request'
      )[1];

      const mockCallback = jest.fn();
      await eventHandler(
        {
          unitId: mockUnitId,
          targetX: 10,
          targetY: 10,
        },
        mockCallback
      );

      expect(mockGameManager.requestPath).toHaveBeenCalledWith(mockPlayerId, mockUnitId, 10, 10);

      expect(mockCallback).toHaveBeenCalledWith(mockPathResult);
      expect(mockSocket.emit).toHaveBeenCalledWith('path_response', {
        ...mockPathResult,
        unitId: mockUnitId,
        targetX: 10,
        targetY: 10,
      });
    });
  });

  describe('utility methods', () => {
    it('should return handled packet types', () => {
      const types = handler.getHandledPacketTypes();
      expect(types).toContain(PacketType.UNIT_MOVE);
      expect(types).toContain(PacketType.UNIT_ATTACK);
      expect(types).toContain(PacketType.UNIT_FORTIFY);
      expect(types).toContain(PacketType.UNIT_CREATE);
    });

    it('should return handler name', () => {
      expect(handler.getName()).toBe('UnitActionHandler');
    });
  });
});
