import { GameManager } from '@game/managers/GameManager';
import { PacketHandler } from '@network/PacketHandler';
import { MapVisibilityHandler } from '@network/handlers/MapVisibilityHandler';
import { PacketType } from '@app-types/packet';
import { Server, Socket } from 'socket.io';

jest.mock('../../../src/utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('MapVisibilityHandler tile visibility flow', () => {
  const socketId = 'socket-1';
  const userId = 'user-1';
  const playerId = 'player-1';
  const gameId = 'game-1';
  let packetHandler: jest.Mocked<PacketHandler>;
  let socket: jest.Mocked<Socket>;
  let gameManager: jest.Mocked<GameManager>;

  beforeEach(() => {
    packetHandler = {
      register: jest.fn(),
      send: jest.fn(),
    } as any;
    socket = {
      id: socketId,
      on: jest.fn(),
    } as any;
    gameManager = {
      getGame: jest.fn().mockResolvedValue({
        players: new Map([[playerId, { id: playerId, userId }]]),
      }),
      getTileVisibility: jest.fn().mockReturnValue({
        isVisible: true,
        isExplored: true,
        lastSeen: 12,
      }),
      setDebugVisibility: jest.fn().mockReturnValue(true),
    } as any;
  });

  const registeredTileHandler = () =>
    (packetHandler.register as jest.Mock).mock.calls.find(
      call => call[0] === PacketType.TILE_VISIBILITY_REQ
    )[1] as (socket: Socket, data: { x: number; y: number }) => Promise<void>;

  const registeredDebugHandler = () =>
    (packetHandler.register as jest.Mock).mock.calls.find(
      call => call[0] === PacketType.DEBUG_VISIBILITY_SET
    )[1] as (socket: Socket, data: { enabled: boolean }) => Promise<void>;

  it('registers a validated request and returns player-scoped visibility', async () => {
    const handler = new MapVisibilityHandler(
      new Map([[socketId, { userId, gameId }]]),
      gameManager
    );
    handler.register(packetHandler, {} as Server, socket);

    expect(packetHandler.register).toHaveBeenCalledWith(
      PacketType.TILE_VISIBILITY_REQ,
      expect.any(Function),
      expect.any(Object)
    );
    await registeredTileHandler()(socket, { x: 4, y: 7 });

    expect(gameManager.getTileVisibility).toHaveBeenCalledWith(gameId, playerId, 4, 7);
    expect(packetHandler.send).toHaveBeenCalledWith(socket, PacketType.TILE_VISIBILITY_REPLY, {
      success: true,
      x: 4,
      y: 7,
      isVisible: true,
      isExplored: true,
      lastSeen: 12,
    });
  });

  it('returns an explicit error reply when the caller is unauthorized', async () => {
    const handler = new MapVisibilityHandler(new Map(), gameManager);
    handler.register(packetHandler, {} as Server, socket);

    await registeredTileHandler()(socket, { x: 4, y: 7 });

    expect(gameManager.getTileVisibility).not.toHaveBeenCalled();
    expect(packetHandler.send).toHaveBeenCalledWith(
      socket,
      PacketType.TILE_VISIBILITY_REPLY,
      expect.objectContaining({
        success: false,
        x: 4,
        y: 7,
        message: 'Not authenticated or not in a game',
      })
    );
  });

  it('enables development debug visibility for the authenticated player', async () => {
    const handler = new MapVisibilityHandler(
      new Map([[socketId, { userId, gameId }]]),
      gameManager
    );
    handler.register(packetHandler, {} as Server, socket);

    await registeredDebugHandler()(socket, { enabled: true });

    expect(gameManager.setDebugVisibility).toHaveBeenCalledWith(gameId, playerId, true);
    expect(packetHandler.send).toHaveBeenCalledWith(socket, PacketType.DEBUG_VISIBILITY_REPLY, {
      success: true,
      enabled: true,
      message: undefined,
    });
  });
});
