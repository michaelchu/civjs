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

  it('uses the classic minimum and lead thresholds for cultural domination', async () => {
    const databaseProvider = createMockDatabaseProvider();
    const database = databaseProvider.getDatabase() as any;
    database.query.players.findMany.mockResolvedValue([
      { id: 'winner', civilization: 'Roman', history: 0, isAlive: true },
      { id: 'defeated', civilization: 'Greek', history: 0, isAlive: true },
    ]);
    unitsByPlayer.defeated = [{ id: 'unit-2' }];
    const cultureManager = {
      getPlayerCultureInfo: jest.fn(async (playerId: string) => ({
        totalCulture: playerId === 'winner' ? 1201 : 400,
      })),
    } as any;

    const result = await new EndGameService(databaseProvider, io).evaluate({
      gameId: 'game-1',
      turn: 80,
      year: 1000,
      victoryConditions: ['culture'],
      playerIds: ['winner', 'defeated'],
      cityManager,
      unitManager,
      researchManager,
      cultureManager,
    });

    expect(result.report).toEqual(
      expect.objectContaining({
        reason: 'culture',
        winnerPlayerId: 'winner',
        winnerPlayerIds: ['winner'],
      })
    );
    unitsByPlayer.defeated = [];
  });

  it('awards all survivors after the configured uninterrupted world-peace period', async () => {
    const databaseProvider = createMockDatabaseProvider();
    const database = databaseProvider.getDatabase() as any;
    database.query.players.findMany.mockResolvedValue([
      { id: 'winner', civilization: 'Roman', history: 0, isAlive: true },
      { id: 'defeated', civilization: 'Greek', history: 0, isAlive: true },
    ]);
    unitsByPlayer.defeated = [{ id: 'unit-2' }];
    const diplomacyManager = {
      getSnapshot: jest.fn(async (_gameId: string, playerId: string) => ({
        playerId,
        nations: [
          {
            id: playerId === 'winner' ? 'defeated' : 'winner',
            relation: {
              state: 'peace',
              sinceTurn: 10,
              embassy: false,
              sharedVision: false,
            },
          },
        ],
      })),
    } as any;

    const result = await new EndGameService(databaseProvider, io).evaluate({
      gameId: 'game-1',
      turn: 30,
      year: -2800,
      victoryConditions: ['world_peace'],
      playerIds: ['winner', 'defeated'],
      cityManager,
      unitManager,
      researchManager,
      diplomacyManager,
    });

    expect(result.report).toEqual(
      expect.objectContaining({
        reason: 'world_peace',
        winnerPlayerIds: ['winner', 'defeated'],
      })
    );
    unitsByPlayer.defeated = [];
  });

  it('persists a launch-ready spaceship and awards science victory on arrival', async () => {
    const databaseProvider = createMockDatabaseProvider();
    const database = databaseProvider.getDatabase() as any;
    database.query.players.findMany.mockResolvedValue([
      {
        id: 'winner',
        civilization: 'Roman',
        isAlive: true,
        spaceshipState: {
          structurals: 16,
          components: 8,
          modules: 3,
          launchedTurn: 20,
          arrivalTurn: 30,
        },
      },
      { id: 'defeated', civilization: 'Greek', isAlive: true },
    ]);
    unitsByPlayer.defeated = [{ id: 'unit-2' }];

    const result = await new EndGameService(databaseProvider, io).evaluate({
      gameId: 'game-1',
      turn: 30,
      year: 1900,
      victoryConditions: ['science'],
      playerIds: ['winner', 'defeated'],
      cityManager,
      unitManager,
      researchManager,
    });

    expect(result.report).toEqual(
      expect.objectContaining({ reason: 'science', winnerPlayerIds: ['winner'] })
    );
    unitsByPlayer.defeated = [];
  });

  it('automatically launches a newly completed national spaceship', async () => {
    const databaseProvider = createMockDatabaseProvider();
    const database = databaseProvider.getDatabase() as any;
    database.query.players.findMany.mockResolvedValue([
      {
        id: 'winner',
        civilization: 'Roman',
        isAlive: true,
        spaceshipState: { structurals: 16, components: 8, modules: 3 },
      },
      { id: 'defeated', civilization: 'Greek', isAlive: true },
    ]);
    unitsByPlayer.defeated = [{ id: 'unit-2' }];
    const spaceshipStateSink = jest.fn();

    await expect(
      new EndGameService(databaseProvider, io).evaluate({
        gameId: 'game-1',
        turn: 20,
        year: 1800,
        victoryConditions: ['science'],
        playerIds: ['winner', 'defeated'],
        cityManager,
        unitManager,
        researchManager,
        spaceshipStateSink,
      })
    ).resolves.toEqual({ ended: false });

    expect(database.update).toHaveBeenCalled();
    expect(database.set).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceshipState: {
          structurals: 16,
          components: 8,
          modules: 3,
          launchedTurn: 20,
          arrivalTurn: 30,
        },
      })
    );
    expect(spaceshipStateSink).toHaveBeenCalledWith('winner', {
      structurals: 16,
      components: 8,
      modules: 3,
      launchedTurn: 20,
      arrivalTurn: 30,
    });
    unitsByPlayer.defeated = [];
  });

  it('waits for the best possible ship before launching for a default AI player', async () => {
    const databaseProvider = createMockDatabaseProvider();
    const database = databaseProvider.getDatabase() as any;
    const winner = {
      id: 'winner',
      civilization: 'Roman',
      isAlive: true,
      isAI: true,
      spaceshipState: { structurals: 16, components: 8, modules: 3 },
    };
    database.query.players.findMany.mockResolvedValue([
      winner,
      { id: 'defeated', civilization: 'Greek', isAlive: true },
    ]);
    unitsByPlayer.defeated = [{ id: 'unit-2' }];
    const service = new EndGameService(databaseProvider, io);

    await service.evaluate({
      gameId: 'game-1',
      turn: 20,
      year: 1800,
      victoryConditions: ['science'],
      playerIds: ['winner', 'defeated'],
      cityManager,
      unitManager,
      researchManager,
    });
    expect(database.set).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceshipState: { structurals: 16, components: 8, modules: 3 },
      })
    );

    winner.spaceshipState = { structurals: 32, components: 16, modules: 12 };
    jest.clearAllMocks();
    database.query.players.findMany.mockResolvedValue([
      winner,
      { id: 'defeated', civilization: 'Greek', isAlive: true },
    ]);
    await service.evaluate({
      gameId: 'game-1',
      turn: 21,
      year: 1820,
      victoryConditions: ['science'],
      playerIds: ['winner', 'defeated'],
      cityManager,
      unitManager,
      researchManager,
    });
    expect(database.set).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceshipState: expect.objectContaining({
          launchedTurn: 21,
          arrivalTurn: 31,
        }),
      })
    );
    unitsByPlayer.defeated = [];
  });

  it('awards a surviving team together', async () => {
    const databaseProvider = createMockDatabaseProvider();
    const database = databaseProvider.getDatabase() as any;
    database.query.players.findMany.mockResolvedValue([
      { id: 'winner', civilization: 'Roman', isAlive: true, teamId: 'team-1' },
      { id: 'defeated', civilization: 'Greek', isAlive: true, teamId: 'team-1' },
    ]);
    unitsByPlayer.defeated = [{ id: 'unit-2' }];

    const result = await new EndGameService(databaseProvider, io).evaluate({
      gameId: 'game-1',
      turn: 12,
      year: -3500,
      victoryConditions: ['conquest'],
      playerIds: ['winner', 'defeated'],
      cityManager,
      unitManager,
      researchManager,
    });

    expect(result.report).toEqual(
      expect.objectContaining({
        reason: 'team',
        winnerPlayerIds: ['winner', 'defeated'],
      })
    );
    unitsByPlayer.defeated = [];
  });

  it('uses deterministic score standings at the configured turn limit', async () => {
    const databaseProvider = createMockDatabaseProvider();
    const database = databaseProvider.getDatabase() as any;
    database.query.players.findMany.mockResolvedValue([
      { id: 'winner', civilization: 'Roman', isAlive: true },
      { id: 'defeated', civilization: 'Greek', isAlive: true },
    ]);
    unitsByPlayer.defeated = [{ id: 'unit-2' }];

    const result = await new EndGameService(databaseProvider, io).evaluate({
      gameId: 'game-1',
      turn: 100,
      year: 2000,
      maxTurns: 100,
      victoryConditions: [],
      playerIds: ['winner', 'defeated'],
      cityManager,
      unitManager,
      researchManager,
    });

    expect(result.report).toEqual(
      expect.objectContaining({ reason: 'max_turns', winnerPlayerIds: ['winner'] })
    );
    unitsByPlayer.defeated = [];
  });
});
