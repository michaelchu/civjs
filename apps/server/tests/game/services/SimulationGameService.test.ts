import { SimulationGameService } from '@game/simulation/runtime/SimulationGameService';
import type { HeadlessSimulationConfig } from '@game/simulation/config/SimulationTypes';
import { users } from '@database/schema';

const config: HeadlessSimulationConfig = {
  name: 'cleanup test',
  aiPlayerCount: 2,
  mapWidth: 20,
  mapHeight: 20,
  mapSeed: 'map-seed',
  randomSeed: 1,
  ruleset: 'civ2civ3',
  turnTimeLimit: 300,
  maxTurns: 10,
  victoryConditions: ['max_turns'],
  aiLevel: 'easy',
  terrainSettings: {
    generator: 'random',
    landmass: 'normal',
    huts: 15,
    temperature: 50,
    wetness: 50,
    rivers: 50,
    resources: 'normal',
  },
};

function createDatabase() {
  const insertValues = jest.fn().mockResolvedValue(undefined);
  const updateWhere = jest.fn().mockResolvedValue(undefined);
  const deleteWhere = jest.fn().mockResolvedValue(undefined);
  return {
    insertValues,
    deleteWhere,
    database: {
      insert: jest.fn(() => ({ values: insertValues })),
      update: jest.fn(() => ({ set: jest.fn(() => ({ where: updateWhere })) })),
      delete: jest.fn(() => ({ where: deleteWhere })),
      query: { players: { findMany: jest.fn().mockResolvedValue([]) } },
    },
  };
}

describe('SimulationGameService', () => {
  it('removes the game and synthetic host when setup fails after creation', async () => {
    const { database, deleteWhere } = createDatabase();
    const gameManager = {
      createGame: jest.fn().mockResolvedValue('game-id'),
      ensureMinimumPlayers: jest.fn().mockRejectedValue(new Error('AI setup failed')),
      deleteGame: jest.fn().mockResolvedValue(undefined),
    };
    const service = new SimulationGameService(
      gameManager as any,
      {
        getDatabase: () => database,
      } as any
    );

    await expect(service.createAndStart(config, 'run-id')).rejects.toThrow('AI setup failed');

    expect(gameManager.deleteGame).toHaveBeenCalledWith('game-id', expect.any(String));
    expect(database.delete).toHaveBeenCalledWith(users);
    expect(deleteWhere).toHaveBeenCalledTimes(1);
  });

  it('skips game deletion when setup fails before a game id exists', async () => {
    const { database } = createDatabase();
    const gameManager = {
      createGame: jest.fn().mockRejectedValue(new Error('creation failed')),
      deleteGame: jest.fn(),
    };
    const service = new SimulationGameService(
      gameManager as any,
      { getDatabase: () => database } as any
    );

    await expect(service.createAndStart(config, 'run-id')).rejects.toThrow('creation failed');

    expect(gameManager.deleteGame).not.toHaveBeenCalled();
    expect(database.delete).toHaveBeenCalledWith(users);
  });

  it('preserves the setup failure as the cause when cleanup also fails', async () => {
    const originalError = new Error('AI setup failed');
    const { database, deleteWhere } = createDatabase();
    deleteWhere.mockRejectedValue(new Error('host cleanup failed'));
    const gameManager = {
      createGame: jest.fn().mockResolvedValue('game-id'),
      ensureMinimumPlayers: jest.fn().mockRejectedValue(originalError),
      deleteGame: jest.fn().mockRejectedValue(new Error('game cleanup failed')),
    };
    const service = new SimulationGameService(
      gameManager as any,
      { getDatabase: () => database } as any
    );

    const error = await service.createAndStart(config, 'run-id').catch(reason => reason);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('game cleanup failed; host cleanup failed');
    expect(error.cause).toBe(originalError);
  });
});
