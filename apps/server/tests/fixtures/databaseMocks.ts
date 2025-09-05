import { jest } from '@jest/globals';

export interface MockGameData {
  id: string;
  name: string;
  hostId: string;
  maxPlayers: number;
  mapWidth: number;
  mapHeight: number;
  status: string;
  players: any[];
}

export function createDatabaseMocks() {
  let gameCounter = 0;
  let playerCounter = 0;
  let cityCounter = 0;
  let unitCounter = 0;

  // Track mock state
  let mockGameData: MockGameData = {
    id: 'game-1',
    name: 'Test Game',
    hostId: 'host-user-id',
    maxPlayers: 2,
    mapWidth: 20,
    mapHeight: 20,
    status: 'waiting',
    players: [],
  };

  const mockDb: any = {
    query: {
      games: {
        findFirst: jest.fn().mockImplementation(() => {
          return Promise.resolve(mockGameData);
        }),
      },
    },
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    returning: jest.fn().mockImplementation((): Promise<any[]> => {
      const query: any = (mockDb.values as any).mock.calls[
        (mockDb.values as any).mock.calls.length - 1
      ]?.[0];
      return handleReturning(query);
    }),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn(() => Promise.resolve([])),
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
  };

  const resetMocks = () => {
    gameCounter = 0;
    playerCounter = 0;
    cityCounter = 0;
    unitCounter = 0;

    mockGameData = {
      id: 'game-1',
      name: 'Test Game',
      hostId: 'host-user-id',
      maxPlayers: 2,
      mapWidth: 20,
      mapHeight: 20,
      status: 'waiting',
      players: [],
    };

    jest.clearAllMocks();
  };

  const updateMockGameData = (updates: Partial<MockGameData>) => {
    mockGameData = { ...mockGameData, ...updates };
  };

  function handleReturning(query: any): Promise<any[]> {
    if (isGameInsert(query)) {
      const newGame: any = buildNewGame(query);
      mockGameData = updateGameDataFromInsert(mockGameData, newGame, query);
      return Promise.resolve([newGame]);
    }

    if (isPlayerInsert(query)) {
      const newPlayer: any = buildNewPlayer(query);
      mockGameData.players.push(newPlayer);
      return Promise.resolve([newPlayer]);
    }

    if (isCityInsert(query)) {
      return Promise.resolve([{ id: `city-${++cityCounter}`, ...query }]);
    }

    if (isUnitInsert(query)) {
      return Promise.resolve([{ id: `unit-${++unitCounter}`, ...query }]);
    }

    return Promise.resolve([{ id: `default-${Date.now()}` }]);
  }

  function isGameInsert(query: any): boolean {
    return !!(query && query.hostId);
  }

  function isPlayerInsert(query: any): boolean {
    return !!(query && query.userId);
  }

  function isCityInsert(query: any): boolean {
    return !!(query && query.name && query.x !== undefined);
  }

  function isUnitInsert(query: any): boolean {
    return !!(query && query.unitType);
  }

  function buildNewGame(query: any): any {
    return {
      id: `game-${++gameCounter}`,
      name: query.name,
      hostId: query.hostId,
    };
  }

  function updateGameDataFromInsert(current: MockGameData, newGame: any, query: any): MockGameData {
    return {
      ...current,
      id: newGame.id,
      name: newGame.name,
      hostId: newGame.hostId,
      maxPlayers: query.maxPlayers || 2,
      mapWidth: query.mapWidth || 20,
      mapHeight: query.mapHeight || 20,
      players: [],
    };
  }

  function buildNewPlayer(query: any): any {
    return {
      id: `player-${++playerCounter}`,
      gameId: query.gameId,
      userId: query.userId,
      playerNumber: query.playerNumber,
      civilization: query.civilization,
    };
  }

  return {
    mockDb,
    mockGameData,
    resetMocks,
    updateMockGameData,
  };
}
