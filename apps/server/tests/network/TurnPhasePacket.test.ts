import { BeginTurnSchema, NewTurnSchema, PacketType } from '@app-types/packet';
import { TurnManagementHandler } from '@network/handlers/TurnManagementHandler';

describe('turn phase packet contracts', () => {
  it('accepts an authoritative phase on new-turn packets', () => {
    expect(NewTurnSchema.parse({ turn: 4, year: -3850, phase: 'research' })).toEqual({
      turn: 4,
      year: -3850,
      phase: 'research',
    });
  });

  it('keeps phase optional for legacy begin-turn packets', () => {
    expect(BeginTurnSchema.parse({ turn: 4, playerId: 'player-1' })).toEqual({
      turn: 4,
      playerId: 'player-1',
    });
  });

  it('broadcasts the game instance phase on turn start', async () => {
    jest.useFakeTimers();
    try {
      const emit = jest.fn();
      const io = { to: jest.fn(() => ({ emit })) };
      const gameManager = {
        getGame: jest.fn().mockResolvedValue({ currentTurn: 4 }),
        getGameInstance: jest.fn().mockReturnValue({
          turnPhase: 'production',
          turnManager: { getCurrentYear: jest.fn(() => -3850) },
        }),
      };
      const handler = new TurnManagementHandler(new Map(), gameManager as never);

      await (
        handler as unknown as { notifyTurnStart: (io: unknown, gameId: string) => Promise<void> }
      ).notifyTurnStart(io, 'game-1');
      jest.advanceTimersByTime(10);

      expect(emit).toHaveBeenCalledWith(
        'packet',
        expect.objectContaining({
          type: PacketType.NEW_YEAR,
          data: expect.objectContaining({ turn: 4, year: -3850 }),
        })
      );
      expect(emit).toHaveBeenCalledWith(
        'packet',
        expect.objectContaining({
          type: PacketType.TURN_START,
          data: { turn: 4, year: -3850, phase: 'production' },
        })
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('resolves an end-turn player from the mounted game without a database read', async () => {
    const players = new Map([['player-1', { id: 'player-1', userId: 'user-1' }]]);
    const gameManager = {
      getGameInstance: jest.fn().mockReturnValue({ players }),
      getAllGames: jest.fn().mockRejectedValue(new Error('database unavailable')),
    };
    const handler = new TurnManagementHandler(new Map(), gameManager as never);

    const playerId = await (
      handler as unknown as {
        resolvePlayerIdForTurn: (connection: unknown) => Promise<string | null>;
      }
    ).resolvePlayerIdForTurn({ gameId: 'game-1', userId: 'user-1' });

    expect(playerId).toBe('player-1');
    expect(gameManager.getAllGames).not.toHaveBeenCalled();
  });
});
