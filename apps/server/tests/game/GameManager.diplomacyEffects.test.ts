import { GameManager } from '@game/managers/GameManager';
import { createMockDatabaseProvider } from '../utils/mockDatabaseProvider';
import { createMockSocketServer } from '../utils/gameTestUtils';

describe('GameManager diplomacy effect turn wiring', () => {
  beforeEach(() => {
    (GameManager as any).instance = null;
  });

  /**
   * @evidence stack
   * @contract The authoritative turn composition applies ruleset-owned diplomacy effects after treaty timers and before it refreshes visibility and trade-route eligibility.
   */
  it('applies automatic diplomacy effects before dependent runtime refreshes', async () => {
    const manager = GameManager.getInstance(
      createMockSocketServer() as any,
      createMockDatabaseProvider()
    );
    const calls: string[] = [];
    const processTurn = jest.fn(async () => {
      calls.push('timers');
      return [];
    });
    const applyEffectContacts = jest.fn(async () => {
      calls.push('effects');
    });
    (manager as any).diplomacyManager = { processTurn, applyEffectContacts };
    jest.spyOn(manager as any, 'refreshSharedVision').mockImplementation(async () => {
      calls.push('visibility');
    });
    const updateTradeRoutesForDiplomacy = jest.fn(async () => {
      calls.push('trade');
    });
    const game = {
      players: new Map([
        ['p1', { id: 'p1' }],
        ['p2', { id: 'p2' }],
      ]),
      cityManager: { updateTradeRoutesForDiplomacy },
    } as any;

    await (manager as any).processDiplomacyTurn('game-1', game);

    expect(processTurn).toHaveBeenCalledWith('game-1');
    expect(applyEffectContacts).toHaveBeenCalledWith('game-1');
    expect(updateTradeRoutesForDiplomacy).toHaveBeenCalledWith('p1', 'p2');
    expect(calls).toEqual(['timers', 'effects', 'visibility', 'trade']);
  });
});
