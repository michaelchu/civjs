import { NativeSaveService } from '@game/services/NativeSaveService';
import type { GameReplayService } from '@game/services/GameReplayService';

describe('NativeSaveService', () => {
  const replay = {
    gameId: 'game-1',
    status: 'ended',
    endGameReport: {},
    turns: [
      {
        id: 'turn-1',
        turn: 1,
        year: -4000,
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        endedAt: new Date('2026-01-01T00:01:00.000Z'),
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
          map: {},
        },
      },
    ],
  };

  it('round-trips a checksummed CivJS-native archive', async () => {
    const replayService = { getReplay: jest.fn().mockResolvedValue(replay) };
    const service = new NativeSaveService(replayService as unknown as GameReplayService);

    const archive = await service.export('game-1');

    expect(archive).toEqual(
      expect.objectContaining({
        format: 'civjs-native-save',
        version: 1,
        gameId: 'game-1',
        throughTurn: 1,
        checksum: expect.any(String),
      })
    );
    expect(service.load(JSON.parse(JSON.stringify(archive))).checkpoint.turn).toBe(1);
  });

  it('rejects modified archives', async () => {
    const replayService = { getReplay: jest.fn().mockResolvedValue(replay) };
    const service = new NativeSaveService(replayService as unknown as GameReplayService);
    const archive = await service.export('game-1');

    expect(() => service.load({ ...archive, throughTurn: 9 })).toThrow('checksum mismatch');
  });
});
