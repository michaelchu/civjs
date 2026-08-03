import { SpaceshipHandler } from '@network/handlers/SpaceshipHandler';
import { PacketHandler } from '@network/PacketHandler';
import { PacketType } from '@app-types/packet';
import { GameManager } from '@game/managers/GameManager';
import { Server, Socket } from 'socket.io';

jest.mock('../../../src/utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('SpaceshipHandler', () => {
  const socketId = 'socket-1';
  const userId = 'user-1';
  const playerId = 'player-1';
  const gameId = 'game-1';
  let packetHandler: jest.Mocked<PacketHandler>;
  let socket: jest.Mocked<Socket>;
  let gameManager: jest.Mocked<GameManager>;

  beforeEach(() => {
    packetHandler = { register: jest.fn(), send: jest.fn() } as any;
    socket = { id: socketId } as any;
    gameManager = {
      getGameInstance: jest.fn(),
      recoverGameInstance: jest.fn(),
      placeSpaceshipPart: jest.fn(),
      launchSpaceship: jest.fn(),
    } as any;
  });

  const register = (role: 'player' | 'spectator' = 'player') => {
    const handler = new SpaceshipHandler(
      new Map([[socketId, { userId, gameId, role }]]),
      gameManager
    );
    handler.register(packetHandler, {} as Server, socket);
  };

  const registeredHandler = (type: PacketType) =>
    (packetHandler.register as jest.Mock).mock.calls.find(call => call[0] === type)![1] as (
      socket: Socket,
      data: any
    ) => Promise<void>;

  const activeGame = () => ({
    state: 'active',
    players: new Map([[playerId, { id: playerId, userId }]]),
  });

  it('routes a valid player placement through the authoritative game manager', async () => {
    gameManager.getGameInstance.mockReturnValue(activeGame() as any);
    gameManager.placeSpaceshipPart.mockResolvedValue({
      success: true,
      state: { structurals: 1, components: 0, modules: 0, placedStructurals: [0] },
    });
    register();

    await registeredHandler(PacketType.SPACESHIP_PLACE)(socket, {
      placement: { kind: 'structural', index: 0 },
    });

    expect(gameManager.placeSpaceshipPart).toHaveBeenCalledWith(gameId, playerId, {
      kind: 'structural',
      index: 0,
    });
    expect(packetHandler.send).toHaveBeenCalledWith(socket, PacketType.SPACESHIP_PLACE_REPLY, {
      success: true,
      spaceshipState: { structurals: 1, components: 0, modules: 0, placedStructurals: [0] },
    });
  });

  it('routes a player launch and returns the source validation result', async () => {
    gameManager.getGameInstance.mockReturnValue(activeGame() as any);
    gameManager.launchSpaceship.mockResolvedValue({
      success: false,
      state: { structurals: 8, components: 2, modules: 3 },
      reason: 'A capital is required to launch',
    });
    register();

    await registeredHandler(PacketType.SPACESHIP_LAUNCH)(socket, {});

    expect(gameManager.launchSpaceship).toHaveBeenCalledWith(gameId, playerId);
    expect(packetHandler.send).toHaveBeenCalledWith(socket, PacketType.SPACESHIP_LAUNCH_REPLY, {
      success: false,
      spaceshipState: { structurals: 8, components: 2, modules: 3 },
      message: 'A capital is required to launch',
    });
  });

  it('rejects spectators before mutation reaches the game manager', async () => {
    register('spectator');

    await registeredHandler(PacketType.SPACESHIP_LAUNCH)(socket, {});

    expect(gameManager.launchSpaceship).not.toHaveBeenCalled();
    expect(packetHandler.send).toHaveBeenCalledWith(socket, PacketType.SPACESHIP_LAUNCH_REPLY, {
      success: false,
      message: 'Game is not active',
    });
  });
});
