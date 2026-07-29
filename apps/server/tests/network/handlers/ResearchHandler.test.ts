import { GameManager } from '@game/managers/GameManager';
import { ResearchHandler } from '@network/handlers/ResearchHandler';
import { PacketHandler } from '@network/PacketHandler';
import { PacketType } from '@app-types/packet';
import { Server, Socket } from 'socket.io';

jest.mock('../../../src/utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('ResearchHandler game lifecycle boundaries', () => {
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
    socket = { id: socketId } as any;
    gameManager = {
      getGame: jest.fn(),
      getGameInstance: jest.fn(),
      recoverGameInstance: jest.fn(),
      getAvailableTechnologies: jest.fn(),
      getPlayerResearch: jest.fn(),
      getResearchProgress: jest.fn(),
      setPlayerResearch: jest.fn(),
      setResearchGoal: jest.fn(),
    } as any;
  });

  const register = () => {
    const handler = new ResearchHandler(
      new Map([[socketId, { userId, gameId, role: 'player' }]]),
      gameManager
    );
    handler.register(packetHandler, {} as Server, socket);
  };

  const registeredHandler = (type: PacketType) =>
    (packetHandler.register as jest.Mock).mock.calls.find(call => call[0] === type)![1] as (
      socket: Socket,
      data: any
    ) => Promise<void>;

  const createGameInstance = () => ({
    players: new Map([[playerId, { id: playerId, userId }]]),
    researchManager: {
      getTechnologyCatalogue: jest.fn().mockReturnValue([
        {
          id: 'alphabet',
          name: 'Alphabet',
          cost: 10,
          requirements: [],
          flags: [],
        },
      ]),
    },
  });

  it.each([PacketType.RESEARCH_LIST, PacketType.RESEARCH_PROGRESS])(
    'ignores %s while the game is still waiting',
    async packetType => {
      gameManager.getGame.mockResolvedValue({ status: 'waiting' } as any);
      register();

      await registeredHandler(packetType)(socket, {});

      expect(gameManager.getGameInstance).not.toHaveBeenCalled();
      expect(gameManager.recoverGameInstance).not.toHaveBeenCalled();
      expect(gameManager.getAvailableTechnologies).not.toHaveBeenCalled();
      expect(gameManager.getPlayerResearch).not.toHaveBeenCalled();
      expect(packetHandler.send).not.toHaveBeenCalled();
    }
  );

  it('serves the research catalogue from the active local game instance', async () => {
    const game = createGameInstance();
    gameManager.getGame.mockResolvedValue({ status: 'active' } as any);
    gameManager.getGameInstance.mockReturnValue(game as any);
    gameManager.getAvailableTechnologies.mockReturnValue([
      {
        id: 'alphabet',
        name: 'Alphabet',
        cost: 10,
        requirements: [],
        flags: [],
      },
    ] as any);
    gameManager.getPlayerResearch.mockReturnValue({
      researchedTechs: new Set<string>(),
      futureTechs: 0,
    } as any);
    register();

    await registeredHandler(PacketType.RESEARCH_LIST)(socket, {});

    expect(game.researchManager.getTechnologyCatalogue).toHaveBeenCalledWith(playerId);
    expect(gameManager.recoverGameInstance).not.toHaveBeenCalled();
    expect(packetHandler.send).toHaveBeenCalledWith(socket, PacketType.RESEARCH_LIST_REPLY, {
      technologies: [
        {
          id: 'alphabet',
          name: 'Alphabet',
          cost: 10,
          requirements: [],
          flags: [],
          description: undefined,
        },
      ],
      availableTechs: [
        {
          id: 'alphabet',
          name: 'Alphabet',
          cost: 10,
          requirements: [],
          flags: [],
          description: undefined,
        },
      ],
      researchedTechs: [],
      futureTechs: 0,
    });
  });

  it('recovers a missing active instance before serving research progress', async () => {
    const game = createGameInstance();
    gameManager.getGame.mockResolvedValue({ status: 'active' } as any);
    gameManager.getGameInstance.mockReturnValue(null);
    gameManager.recoverGameInstance.mockResolvedValue(game as any);
    gameManager.getPlayerResearch.mockReturnValue({
      currentTech: 'alphabet',
      bulbsLastTurn: 2,
    } as any);
    gameManager.getResearchProgress.mockReturnValue({
      current: 4,
      required: 10,
      turnsRemaining: 3,
    } as any);
    register();

    await registeredHandler(PacketType.RESEARCH_PROGRESS)(socket, {});

    expect(gameManager.recoverGameInstance).toHaveBeenCalledWith(gameId);
    expect(packetHandler.send).toHaveBeenCalledWith(socket, PacketType.RESEARCH_PROGRESS_REPLY, {
      currentTech: 'alphabet',
      techGoal: undefined,
      current: 4,
      required: 10,
      turnsRemaining: 3,
      bulbsLastTurn: 2,
    });
  });
});
