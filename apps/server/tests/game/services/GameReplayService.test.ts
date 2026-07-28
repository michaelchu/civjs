import { GameReplayService } from '@game/services/GameReplayService';
import { createMockDatabaseProvider } from '../../utils/mockDatabaseProvider';

describe('GameReplayService', () => {
  it('reconstructs a versioned authoritative checkpoint', async () => {
    const service = new GameReplayService(createMockDatabaseProvider());
    jest.spyOn(service, 'getReplay').mockResolvedValue({
      gameId: 'game-1',
      status: 'ended',
      endGameReport: {},
      turns: [
        {
          id: 'turn-2',
          turn: 2,
          year: -3960,
          startedAt: new Date(),
          endedAt: new Date(),
          actions: {},
          statistics: {},
          phases: [],
          events: [],
          snapshot: {
            version: 2,
            turn: 2,
            year: -3960,
            calendar: {},
            cities: [],
            units: [],
            research: {},
          },
        },
      ],
    });

    await expect(service.reconstructAtTurn('game-1', 2)).resolves.toEqual(
      expect.objectContaining({ version: 2, turn: 2 })
    );
  });

  it('rejects legacy metadata-only snapshots as non-reconstructable', async () => {
    const service = new GameReplayService(createMockDatabaseProvider());
    jest.spyOn(service, 'getReplay').mockResolvedValue({
      gameId: 'game-1',
      status: 'ended',
      endGameReport: {},
      turns: [
        {
          id: 'turn-1',
          turn: 1,
          year: -4000,
          startedAt: new Date(),
          endedAt: new Date(),
          actions: {},
          statistics: {},
          phases: [],
          events: [],
          snapshot: { version: 1, turn: 1 },
        },
      ],
    });

    await expect(service.reconstructAtTurn('game-1', 1)).rejects.toThrow(
      'Unsupported game-state snapshot version'
    );
  });

  it('does not substitute an earlier checkpoint for the requested turn', async () => {
    const service = new GameReplayService(createMockDatabaseProvider());
    jest.spyOn(service, 'getReplay').mockResolvedValue({
      gameId: 'game-1',
      status: 'active',
      endGameReport: {},
      turns: [
        {
          id: 'turn-1',
          turn: 1,
          year: -4000,
          startedAt: new Date(),
          endedAt: new Date(),
          actions: {},
          statistics: {},
          phases: [],
          events: [],
          snapshot: {
            version: 2,
            turn: 1,
            year: -4000,
            calendar: {},
            cities: [],
            units: [],
            research: {},
          },
        },
        {
          id: 'turn-2',
          turn: 2,
          year: -3960,
          startedAt: new Date(),
          endedAt: null,
          actions: {},
          statistics: {},
          phases: [],
          events: [],
          snapshot: null,
        },
      ],
    });

    await expect(service.reconstructAtTurn('game-1', 2)).resolves.toBeNull();
  });
});
