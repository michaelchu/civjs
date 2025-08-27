import { jest } from '@jest/globals';

export function createGameManagerMocks() {
  const mockDb: any = {
    query: {
      games: {
        findFirst: jest.fn().mockImplementation(() =>
          Promise.resolve({
            id: 'test-game-id',
            name: 'Test Game',
            hostId: 'test-host-id',
            maxPlayers: 4,
            mapWidth: 80,
            mapHeight: 50,
            status: 'waiting',
            players: [],
          })
        ),
      },
    },
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    returning: jest.fn().mockImplementation(() =>
      Promise.resolve([
        {
          id: 'test-game-id',
          name: 'Test Game',
          hostId: 'test-host-id',
          maxPlayers: 4,
          mapWidth: 80,
          mapHeight: 50,
          ruleset: 'classic',
        },
      ])
    ),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn(() => Promise.resolve([])),
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
  };

  const resetMocks = () => {
    jest.clearAllMocks();
  };

  return {
    mockDb,
    resetMocks,
  };
}
