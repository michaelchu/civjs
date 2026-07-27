import { EndGameService } from '@game/services/EndGameService';
import { PacketType, PROTOCOL_VERSION } from '@app-types/packet';
import { createMockDatabaseProvider } from '../../utils/mockDatabaseProvider';

const citiesByPlayer: Record<string, Array<{ size: number }>> = {
  winner: [{ size: 5 }, { size: 3 }],
  defeated: [],
};
const unitsByPlayer: Record<string, Array<{ id: string }>> = {
  winner: [{ id: 'unit-1' }],
  defeated: [],
};

describe('EndGameService', () => {
  const emit = jest.fn();
  const io = { to: jest.fn(() => ({ emit })) } as any;
  const cityManager = {
    getPlayerCities: jest.fn((playerId: string) => citiesByPlayer[playerId] ?? []),
  } as any;
  const unitManager = {
    getPlayerUnits: jest.fn((playerId: string) => unitsByPlayer[playerId] ?? []),
  } as any;
  const researchManager = {
    getResearchedTechs: jest.fn((playerId: string) =>
      playerId === 'winner' ? ['alphabet', 'bronze_working'] : ['alphabet']
    ),
  } as any;

  beforeEach(() => jest.clearAllMocks());

  it('persists deterministic standings and broadcasts a conquest report', async () => {
    const databaseProvider = createMockDatabaseProvider();
    const database = databaseProvider.getDatabase() as any;
    database.query.players.findMany.mockResolvedValue([
      {
        id: 'winner',
        civilization: 'Roman',
        history: 10,
        isAlive: true,
      },
      {
        id: 'defeated',
        civilization: 'Greek',
        history: 4,
        isAlive: true,
      },
    ]);

    const result = await new EndGameService(databaseProvider, io).evaluate({
      gameId: 'game-1',
      turn: 42,
      year: -2320,
      victoryConditions: ['conquest'],
      playerIds: ['winner', 'defeated'],
      cityManager,
      unitManager,
      researchManager,
    });

    expect(result).toEqual(
      expect.objectContaining({
        ended: true,
        report: expect.objectContaining({
          winnerPlayerId: 'winner',
          reason: 'conquest',
          turn: 42,
        }),
      })
    );
    expect(result.report?.standings[0]).toEqual(
      expect.objectContaining({
        playerId: 'winner',
        score: 410,
        cities: 2,
        population: 8,
        units: 1,
        technologies: 2,
      })
    );
    expect(emit).toHaveBeenCalledWith('packet', {
      type: PacketType.ENDGAME_REPORT,
      version: PROTOCOL_VERSION,
      data: result.report,
    });
  });

  it('does not end while multiple civilizations retain assets', async () => {
    const databaseProvider = createMockDatabaseProvider();
    const database = databaseProvider.getDatabase() as any;
    database.query.players.findMany.mockResolvedValue([
      { id: 'winner', civilization: 'Roman', history: 0, isAlive: true },
      { id: 'defeated', civilization: 'Greek', history: 0, isAlive: true },
    ]);
    unitsByPlayer.defeated = [{ id: 'unit-2' }];

    const result = await new EndGameService(databaseProvider, io).evaluate({
      gameId: 'game-1',
      turn: 2,
      year: -3960,
      victoryConditions: ['conquest'],
      playerIds: ['winner', 'defeated'],
      cityManager,
      unitManager,
      researchManager,
    });

    expect(result).toEqual({ ended: false });
    expect(emit).not.toHaveBeenCalled();
    unitsByPlayer.defeated = [];
  });
});
