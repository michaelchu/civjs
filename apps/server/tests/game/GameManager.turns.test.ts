import { GameManager } from '@game/managers/GameManager';
import { createMockSocketServer } from '../utils/gameTestUtils';

describe('GameManager turn readiness', () => {
  beforeEach(() => {
    (GameManager as any).instance = null;
  });

  it('advances a single-player game after the human ends turn', async () => {
    const gameManager = GameManager.getInstance(createMockSocketServer() as any);
    const processTurn = jest.fn().mockResolvedValue(undefined);
    const getCurrentTurn = jest.fn().mockReturnValue(2);
    const gameId = 'single-player-game';
    const humanId = 'human-player';
    const aiId = 'ai-player';
    const players = new Map([
      [
        humanId,
        {
          id: humanId,
          userId: 'user-1',
          isAI: false,
          playerNumber: 0,
          civilization: 'roman',
          isReady: true,
          hasEndedTurn: false,
          isConnected: true,
          lastSeen: new Date(),
        },
      ],
      [
        aiId,
        {
          id: aiId,
          userId: null,
          isAI: true,
          playerNumber: 1,
          civilization: 'greek',
          isReady: true,
          hasEndedTurn: false,
          isConnected: true,
          lastSeen: new Date(),
        },
      ],
    ]);

    (gameManager as any).games.set(gameId, {
      id: gameId,
      state: 'active',
      currentTurn: 1,
      players,
      turnManager: { processTurn, getCurrentTurn },
    });
    (gameManager as any).playerToGame.set(humanId, gameId);

    await expect(gameManager.endTurn(humanId)).resolves.toBe(true);
    expect(processTurn).toHaveBeenCalledTimes(1);
    expect(getCurrentTurn).toHaveBeenCalledTimes(1);
    expect(players.get(humanId)?.hasEndedTurn).toBe(false);
    expect(players.get(aiId)?.hasEndedTurn).toBe(false);
  });
});
