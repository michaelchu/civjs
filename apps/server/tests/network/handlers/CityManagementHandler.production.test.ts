import { CityManagementHandler } from '@network/handlers/CityManagementHandler';
import { GameManager } from '@game/managers/GameManager';
import { PacketHandler } from '@network/PacketHandler';
import { PacketType } from '@app-types/packet';
import { Server, Socket } from 'socket.io';

jest.mock('../../../src/utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('CityManagementHandler production socket flow', () => {
  const socketId = 'socket-1';
  const userId = 'user-1';
  const playerId = 'player-1';
  const gameId = 'game-1';
  let socketEvents: Map<string, (...args: any[]) => Promise<void>>;
  let mockSocket: jest.Mocked<Socket>;
  let cityManager: {
    getCitiesMap: jest.Mock;
    getCity: jest.Mock;
    setCityProduction: jest.Mock;
    configureCityGovernor: jest.Mock;
    getCityGovernorInfo: jest.Mock;
    optimizeCityManually: jest.Mock;
    buyProduction: jest.Mock;
    addToWorklist: jest.Mock;
    removeFromWorklist: jest.Mock;
    reorderWorklist: jest.Mock;
    assignCitizenToTile: jest.Mock;
    convertTileWorkerToSpecialist: jest.Mock;
    convertSpecialistToTile: jest.Mock;
    changeSpecialist: jest.Mock;
    refreshCityOutputs: jest.Mock;
    saveCity: jest.Mock;
    renameCity: jest.Mock;
    sellBuildingForPlayer: jest.Mock;
    disbandCity: jest.Mock;
  };

  beforeEach(() => {
    socketEvents = new Map();
    const city = {
      id: 'city-1',
      name: 'Capital',
      playerId,
      size: 3,
      buildings: [],
      productionStock: 10,
      currentProduction: 'warriors',
      productionType: 'unit',
      productionPerTurn: 4,
    };
    cityManager = {
      getCitiesMap: jest.fn(() => new Map([['city-1', city]])),
      getCity: jest.fn((cityId: string) => (cityId === city.id ? city : undefined)),
      setCityProduction: jest.fn().mockResolvedValue(true),
      configureCityGovernor: jest.fn().mockResolvedValue(true),
      getCityGovernorInfo: jest.fn().mockReturnValue({
        isEnabled: true,
        priority: 'food',
      }),
      optimizeCityManually: jest.fn().mockResolvedValue(true),
      buyProduction: jest.fn().mockResolvedValue({
        success: true,
        goldSpent: 20,
        completed: true,
      }),
      addToWorklist: jest.fn().mockResolvedValue(true),
      removeFromWorklist: jest.fn().mockResolvedValue(true),
      reorderWorklist: jest.fn().mockResolvedValue(true),
      assignCitizenToTile: jest.fn().mockResolvedValue(true),
      convertTileWorkerToSpecialist: jest.fn().mockResolvedValue(true),
      convertSpecialistToTile: jest.fn().mockResolvedValue(true),
      changeSpecialist: jest.fn().mockResolvedValue(true),
      refreshCityOutputs: jest.fn(),
      saveCity: jest.fn().mockResolvedValue(true),
      renameCity: jest.fn().mockResolvedValue(true),
      sellBuildingForPlayer: jest.fn().mockResolvedValue({ success: true, goldReceived: 20 }),
      disbandCity: jest.fn().mockResolvedValue({ success: true }),
    };
    mockSocket = {
      id: socketId,
      emit: jest.fn(),
      on: jest.fn((event: string, callback: (...args: any[]) => Promise<void>) => {
        socketEvents.set(event, callback);
        return mockSocket;
      }),
    } as any;
  });

  it('uses the authenticated player ID and persists a legacy socket production change', async () => {
    const gameManager = {
      getGameInstance: jest.fn().mockReturnValue({
        id: gameId,
        state: 'active',
        players: new Map([[playerId, { id: playerId, userId }]]),
        cityManager,
        researchManager: {
          hasPlayerResearched: jest.fn(
            (_ownerId: string, techId: string) => techId !== 'guerilla_warfare'
          ),
        },
      }),
    } as unknown as GameManager;
    const handler = new CityManagementHandler(
      new Map([[socketId, { userId, gameId }]]),
      gameManager
    );

    handler.register({ register: jest.fn() } as unknown as PacketHandler, {} as Server, mockSocket);

    await socketEvents.get('city:changeProduction')!({
      cityId: 'city-1',
      productionId: 'explorer',
      productionType: 'unit',
    });

    expect(cityManager.setCityProduction).toHaveBeenCalledWith(
      'city-1',
      'unit',
      'explorer',
      playerId
    );
    expect(mockSocket.emit).toHaveBeenCalledWith(
      'city:productionChanged',
      expect.objectContaining({ cityId: 'city-1' })
    );
  });

  it('routes the canonical packet through the same authoritative production mutation', async () => {
    const gameInstance = {
      id: gameId,
      state: 'active',
      players: new Map([[playerId, { id: playerId, userId }]]),
      cityManager,
      researchManager: {
        hasPlayerResearched: jest.fn(
          (_ownerId: string, techId: string) => techId !== 'guerilla_warfare'
        ),
      },
    };
    const gameManager = {
      getGame: jest.fn().mockResolvedValue({
        status: 'active',
        players: [{ id: playerId, userId }],
      }),
      getGameInstance: jest.fn().mockReturnValue(gameInstance),
    } as unknown as GameManager;
    const packetHandler = {
      register: jest.fn(),
      send: jest.fn(),
    } as unknown as PacketHandler;
    const handler = new CityManagementHandler(
      new Map([[socketId, { userId, gameId }]]),
      gameManager
    );
    handler.register(packetHandler, {} as Server, mockSocket);
    const packetCallback = (packetHandler.register as jest.Mock).mock.calls.find(
      call => call[0] === PacketType.CITY_PRODUCTION_CHANGE
    )[1];

    await packetCallback(mockSocket, {
      cityId: 'city-1',
      production: 'explorer',
      type: 'unit',
    });

    expect(cityManager.setCityProduction).toHaveBeenCalledWith(
      'city-1',
      'unit',
      'explorer',
      playerId
    );
    expect(packetHandler.send).toHaveBeenCalledWith(
      mockSocket,
      PacketType.CITY_PRODUCTION_CHANGE_REPLY,
      expect.objectContaining({
        success: true,
        cityId: 'city-1',
        production: expect.objectContaining({ type: 'unit' }),
      })
    );
  });

  it('authorizes and applies governor settings for an owned city', async () => {
    const gameManager = {
      getGameInstance: jest.fn().mockReturnValue({
        id: gameId,
        state: 'active',
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
    const callback = jest.fn();

    await socketEvents.get('city:configureGovernor')!(
      {
        cityId: 'city-1',
        enabled: true,
        priority: 'food',
        autoManageSpecialists: true,
        autoManageTiles: true,
        autoManageProduction: false,
        preventStarvation: true,
        maintainHappiness: true,
      },
      callback
    );

    expect(cityManager.configureCityGovernor).toHaveBeenCalledWith(
      'city-1',
      playerId,
      expect.objectContaining({ enabled: true, priority: 'food' })
    );
    expect(callback).toHaveBeenCalledWith({
      success: true,
      governor: { isEnabled: true, priority: 'food' },
    });
  });

  it('exposes citizen optimization and rush production for an owned city', async () => {
    const gameManager = {
      getGameInstance: jest.fn().mockReturnValue({
        id: gameId,
        state: 'active',
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
    const optimizeCallback = jest.fn();
    const buyCallback = jest.fn();

    await socketEvents.get('city:optimizeCitizens')!({ cityId: 'city-1' }, optimizeCallback);
    await socketEvents.get('city:buyProduction')!({ cityId: 'city-1' }, buyCallback);

    expect(cityManager.optimizeCityManually).toHaveBeenCalledWith('city-1');
    expect(optimizeCallback).toHaveBeenCalledWith({ success: true });
    expect(cityManager.buyProduction).toHaveBeenCalledWith('city-1', playerId);
    expect(buyCallback).toHaveBeenCalledWith({
      success: true,
      result: { success: true, goldSpent: 20, completed: true, remainingGold: undefined },
      error: undefined,
    });
  });

  it('exposes authenticated worklist, citizen, rename, and building-sale actions', async () => {
    const broadcastCityData = jest.fn();
    const gameManager = {
      getGameInstance: jest.fn().mockReturnValue({
        id: gameId,
        state: 'active',
        players: new Map([[playerId, { id: playerId, userId }]]),
        cityManager,
        researchManager: { hasPlayerResearched: jest.fn().mockReturnValue(true) },
      }),
      broadcastCityData,
    } as unknown as GameManager;
    const handler = new CityManagementHandler(
      new Map([[socketId, { userId, gameId }]]),
      gameManager
    );
    handler.register({ register: jest.fn() } as unknown as PacketHandler, {} as Server, mockSocket);

    const queueCallback = jest.fn();
    await socketEvents.get('city:addWorklist')!(
      {
        cityId: 'city-1',
        items: [{ productionId: 'armor', type: 'unit' }],
      },
      queueCallback
    );
    expect(cityManager.addToWorklist).toHaveBeenCalledWith(
      'city-1',
      [{ kind: 'unit', value: 'armor' }],
      playerId
    );
    expect(queueCallback).toHaveBeenCalledWith({ success: true, error: undefined });

    const citizenCallback = jest.fn();
    await socketEvents.get('city:assignCitizen')!(
      { cityId: 'city-1', x: 2, y: 3 },
      citizenCallback
    );
    expect(cityManager.assignCitizenToTile).toHaveBeenCalledWith('city-1', 2, 3);
    expect(cityManager.saveCity).toHaveBeenCalledWith('city-1');

    const renameCallback = jest.fn();
    await socketEvents.get('city:rename')!(
      { cityId: 'city-1', name: 'New Capital' },
      renameCallback
    );
    expect(cityManager.renameCity).toHaveBeenCalledWith('city-1', 'New Capital', playerId);

    const saleCallback = jest.fn();
    await socketEvents.get('city:sellBuilding')!(
      { cityId: 'city-1', buildingId: 'granary' },
      saleCallback
    );
    expect(cityManager.sellBuildingForPlayer).toHaveBeenCalledWith('city-1', 'granary', playerId);
    const disbandCallback = jest.fn();
    await socketEvents.get('city:disband')!({ cityId: 'city-1' }, disbandCallback);
    expect(cityManager.disbandCity).toHaveBeenCalledWith('city-1', playerId);
    expect(broadcastCityData).toHaveBeenCalledWith(gameId);
  });
});
