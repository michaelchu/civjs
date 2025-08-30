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

      if (query && query.hostId) {
        // Game insertion
        const newGame: any = {
          id: `game-${++gameCounter}`,
          name: query.name,
          hostId: query.hostId,
        };

        // Update mock game data with new game info
        mockGameData = {
          ...mockGameData,
          id: newGame.id,
          name: newGame.name,
          hostId: newGame.hostId,
          maxPlayers: query.maxPlayers || 2,
          mapWidth: query.mapWidth || 20,
          mapHeight: query.mapHeight || 20,
          players: [],
        };

        return Promise.resolve([newGame]);
      } else if (query && query.userId) {
        // Player insertion
        const newPlayer: any = {
          id: `player-${++playerCounter}`,
          gameId: query.gameId,
          userId: query.userId,
          playerNumber: query.playerNumber,
          civilization: query.civilization,
        };

        // Update mock game data
        mockGameData.players.push(newPlayer);

        return Promise.resolve([newPlayer]);
      } else if (query && query.name && query.x !== undefined) {
        // City insertion
        return Promise.resolve([
          {
            id: `city-${++cityCounter}`,
            ...query,
          },
        ]);
      } else if (query && query.unitType) {
        // Unit insertion
        return Promise.resolve([
          {
            id: `unit-${++unitCounter}`,
            ...query,
          },
        ]);
      }

      // Default fallback
      return Promise.resolve([{ id: `default-${Date.now()}` }]);
    }),
    update: jest.fn().mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([]),
      }),
    }),
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

  return {
    mockDb,
    mockGameData,
    resetMocks,
    updateMockGameData,
  };
}
