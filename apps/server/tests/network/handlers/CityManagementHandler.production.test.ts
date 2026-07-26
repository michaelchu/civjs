import { CityManagementHandler } from '@network/handlers/CityManagementHandler';
import { GameManager } from '@game/managers/GameManager';
import { PacketHandler } from '@network/PacketHandler';
import { Server, Socket } from 'socket.io';

jest.mock('../../../src/utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('CityManagementHandler production socket flow', () => {
  const socketId = 'socket-1';
  const userId = 'user-1';
  const playerId = 'player-1';
  const gameId = 'game-1';
  let socketEvents: Map<string, (data: any) => Promise<void>>;
  let mockSocket: jest.Mocked<Socket>;
  let cityManager: { getCitiesMap: jest.Mock; setCityProduction: jest.Mock };

  beforeEach(() => {
    socketEvents = new Map();
    cityManager = {
      getCitiesMap: jest.fn(
        () =>
          new Map([
            [
              'city-1',
              {
                id: 'city-1',
                name: 'Capital',
                playerId,
                size: 3,
                buildings: [],
                productionStock: 10,
                currentProduction: 'warriors',
                productionType: 'unit',
                productionPerTurn: 4,
              },
            ],
          ])
      ),
      setCityProduction: jest.fn().mockResolvedValue(true),
    };
    mockSocket = {
      id: socketId,
      emit: jest.fn(),
      on: jest.fn((event: string, callback: (data: any) => Promise<void>) => {
        socketEvents.set(event, callback);
        return mockSocket;
      }),
    } as any;
  });

  it('uses the authenticated player ID and persists a legacy socket production change', async () => {
    const gameManager = {
      getGameInstance: jest.fn().mockReturnValue({
        players: new Map([[playerId, { id: playerId, userId }]]),
        cityManager,
        researchManager: { hasPlayerResearched: jest.fn().mockReturnValue(true) },
      }),
    } as unknown as GameManager;
    const handler = new CityManagementHandler(
      new Map([[socketId, { userId, gameId }]]),
      gameManager
    );

    handler.register({ register: jest.fn() } as unknown as PacketHandler, {} as Server, mockSocket);

    await socketEvents.get('city:changeProduction')!({
      cityId: 'city-1',
      productionId: 'archers',
      productionType: 'unit',
    });

    expect(cityManager.setCityProduction).toHaveBeenCalledWith(
      'city-1',
      'unit',
      'archers',
      playerId
    );
    expect(mockSocket.emit).toHaveBeenCalledWith(
      'city:productionChanged',
      expect.objectContaining({ cityId: 'city-1' })
    );
  });
});
