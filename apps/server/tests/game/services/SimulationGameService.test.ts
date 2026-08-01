import { SimulationGameService } from '@game/services/SimulationGameService';

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

    await expect(
      service.createAndStart(
        {
          name: 'cleanup test',
          aiPlayerCount: 2,
          mapWidth: 20,
          mapHeight: 20,
          mapSeed: 'map-seed',
          randomSeed: 1,
          ruleset: 'classic',
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
        },
        'run-id'
      )
    ).rejects.toThrow('AI setup failed');

    expect(gameManager.deleteGame).toHaveBeenCalledWith('game-id', expect.any(String));
    expect(deleteWhere).toHaveBeenCalled();
  });
});
