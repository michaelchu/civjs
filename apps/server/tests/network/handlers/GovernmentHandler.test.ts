import { GovernmentHandler } from '@network/handlers/GovernmentHandler';
import { GameManager } from '@game/managers/GameManager';
import { PacketHandler } from '@network/PacketHandler';
import { Server, Socket } from 'socket.io';

describe('GovernmentHandler', () => {
  const socketId = 'socket-1';
  const userId = 'user-1';
  const playerId = 'player-1';
  const gameId = 'game-1';
  let events: Map<string, (...args: any[]) => Promise<void> | void>;
  let socket: jest.Mocked<Socket>;
  let governmentManager: {
    getPlayerGovernment: jest.Mock;
    getAllGovernments: jest.Mock;
    getAvailableGovernments: jest.Mock;
    startRevolution: jest.Mock;
  };

  beforeEach(() => {
    events = new Map();
    socket = {
      id: socketId,
      on: jest.fn((event: string, callback: (...args: any[]) => Promise<void> | void) => {
        events.set(event, callback);
        return socket;
      }),
    } as any;
    governmentManager = {
      getPlayerGovernment: jest.fn().mockReturnValue({
        currentGovernment: 'despotism',
        revolutionTurns: 0,
      }),
      getAllGovernments: jest.fn().mockReturnValue({
        despotism: { id: 'despotism', name: 'Despotism' },
      }),
      getAvailableGovernments: jest.fn().mockReturnValue([
        {
          id: 'monarchy',
          government: { id: 'monarchy', name: 'Monarchy' },
          available: true,
        },
      ]),
      startRevolution: jest.fn().mockResolvedValue({
        success: true,
        message: 'Revolution started',
      }),
    };
  });

  const register = () => {
    const game = {
      players: new Map([[playerId, { id: playerId, userId }]]),
      governmentManager,
      researchManager: { getResearchedTechs: jest.fn().mockReturnValue(['monarchy']) },
      turnManager: { getCurrentTurn: jest.fn().mockReturnValue(12) },
      cityManager: {
        getPlayerCities: jest.fn().mockReturnValue([{ id: 'city-1' }]),
        refreshCityWithGovernmentEffects: jest.fn(),
      },
    };
    const gameManager = {
      getGameInstance: jest.fn().mockReturnValue(game),
    } as unknown as GameManager;
    const handler = new GovernmentHandler(new Map([[socketId, { userId, gameId }]]), gameManager);
    handler.register({} as PacketHandler, {} as Server, socket);
    return game;
  };

  it('returns authoritative ruleset availability and player state', () => {
    register();
    const callback = jest.fn();

    events.get('government:getState')!({}, callback);

    expect(callback).toHaveBeenCalledWith({
      success: true,
      state: expect.objectContaining({
        currentGovernment: 'despotism',
        revolutionTurns: 0,
        availableGovernments: [{ id: 'monarchy', available: true, reason: undefined }],
      }),
    });
  });

  it('starts an authorized revolution and refreshes affected cities', async () => {
    const game = register();
    const callback = jest.fn();

    await events.get('government:startRevolution')!({ governmentId: 'monarchy' }, callback);

    expect(governmentManager.startRevolution).toHaveBeenCalledWith(
      playerId,
      'monarchy',
      new Set(['monarchy']),
      12
    );
    expect(game.cityManager.refreshCityWithGovernmentEffects).toHaveBeenCalledWith('city-1');
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, message: 'Revolution started' })
    );
  });
});
