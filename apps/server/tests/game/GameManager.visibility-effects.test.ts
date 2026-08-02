import { GameManager } from '@game/managers/GameManager';
import { createMockDatabaseProvider } from '../utils/mockDatabaseProvider';

describe('GameManager c2c3 visibility effects', () => {
  const gameId = 'c2c3-visibility-turn';
  const mockIo = { to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() } as any;
  let manager: GameManager;

  beforeEach(() => {
    (GameManager as any).instance = null;
    manager = GameManager.getInstance(mockIo, createMockDatabaseProvider());
  });

  afterEach(() => manager.clearAllGames());

  /**
   * @evidence parity
   * @reference reference/freeciv/server/srv_main.c:761-798
   * @assertion The authoritative c2c3 turn loop applies player reveal effects after current diplomatic shared vision is refreshed and excludes eliminated players.
   * @c2c3-surface terrain-visibility
   * @c2c3-surface-scenario turn
   */
  it('runs reveal effects for living players after the diplomatic visibility refresh', async () => {
    const applyRevealEffects = jest.fn();
    const updateTradeRoutesForDiplomacy = jest.fn();
    const game = {
      id: gameId,
      players: new Map([
        ['owner', { id: 'owner', isAlive: true }],
        ['eliminated', { id: 'eliminated', isAlive: false }],
      ]),
      cityManager: { updateTradeRoutesForDiplomacy },
      visibilityManager: { applyRevealEffects },
    } as any;
    (manager as any).diplomacyManager = {
      processTurn: jest.fn().mockResolvedValue([]),
      applyEffectContacts: jest.fn().mockResolvedValue(undefined),
    };
    const refreshSharedVision = jest
      .spyOn(manager as any, 'refreshSharedVision')
      .mockResolvedValue(undefined);

    await (manager as any).processDiplomacyTurn(gameId, game);

    expect((manager as any).diplomacyManager.processTurn).toHaveBeenCalledWith(gameId);
    expect((manager as any).diplomacyManager.applyEffectContacts).toHaveBeenCalledWith(gameId);
    expect(refreshSharedVision).toHaveBeenCalledWith(gameId);
    expect(applyRevealEffects).toHaveBeenCalledWith(['owner']);
    expect(refreshSharedVision.mock.invocationCallOrder[0]).toBeLessThan(
      applyRevealEffects.mock.invocationCallOrder[0]
    );
    expect(updateTradeRoutesForDiplomacy).toHaveBeenCalledWith('eliminated', 'owner');
  });
});
