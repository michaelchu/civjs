import { EconomicHandler } from '@network/handlers/EconomicHandler';
import { GameManager } from '@game/managers/GameManager';
import { PacketHandler } from '@network/PacketHandler';
import { Server, Socket } from 'socket.io';

describe('EconomicHandler', () => {
  const socketId = 'socket-1';
  const userId = 'user-1';
  const playerId = 'player-1';
  const gameId = 'game-1';
  let events: Map<string, (...args: any[]) => Promise<void> | void>;
  let socket: jest.Mocked<Socket>;
  let economicManager: { getPlayerTaxRates: jest.Mock; setPlayerTaxRates: jest.Mock };
  let database: any;

  beforeEach(() => {
    events = new Map();
    socket = {
      id: socketId,
      on: jest.fn((event: string, callback: (...args: any[]) => Promise<void> | void) => {
        events.set(event, callback);
        return socket;
      }),
    } as any;
    economicManager = {
      getPlayerTaxRates: jest.fn().mockReturnValue({ tax: 50, luxury: 20, science: 30 }),
      setPlayerTaxRates: jest.fn().mockReturnValue({ isValid: true }),
    };
    const where = jest.fn().mockResolvedValue(undefined);
    const set = jest.fn().mockReturnValue({ where });
    database = { update: jest.fn().mockReturnValue({ set }), set, where };
  });

  const register = () => {
    const gameManager = {
      getGameInstance: jest.fn().mockReturnValue({
        players: new Map([[playerId, { id: playerId, userId }]]),
        turnManager: { getEconomicManager: () => economicManager },
      }),
    } as unknown as GameManager;
    const handler = new EconomicHandler(
      new Map([[socketId, { userId, gameId }]]),
      gameManager,
      database
    );
    handler.register({} as PacketHandler, {} as Server, socket);
  };

  it('loads and persists validated tax rates for the authenticated player', async () => {
    register();
    const getCallback = jest.fn();
    const setCallback = jest.fn();

    events.get('economy:getTaxRates')!({}, getCallback);
    await events.get('economy:setTaxRates')!({ tax: 40, luxury: 10, science: 50 }, setCallback);

    expect(getCallback).toHaveBeenCalledWith({
      success: true,
      rates: { tax: 50, luxury: 20, science: 30 },
    });
    expect(economicManager.setPlayerTaxRates).toHaveBeenCalledWith({
      playerId,
      newRates: { tax: 40, luxury: 10, science: 50 },
    });
    expect(database.set).toHaveBeenCalledWith({
      taxRate: 40,
      luxuryRate: 10,
      scienceRate: 50,
    });
    expect(setCallback).toHaveBeenCalledWith({
      success: true,
      rates: { tax: 40, luxury: 10, science: 50 },
    });
  });
});
