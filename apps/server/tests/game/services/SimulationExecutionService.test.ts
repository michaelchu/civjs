import {
  SimulationExecutionError,
  SimulationExecutionService,
} from '@game/services/SimulationExecutionService';

function createFakeManager() {
  const game = {
    state: 'active',
    turnManager: {
      currentTurn: 1,
      getCurrentTurn() {
        return this.currentTurn;
      },
      async processTurn() {
        this.currentTurn += 1;
        if (this.currentTurn >= 2) game.state = 'ended';
      },
    },
  };
  return {
    game,
    manager: { getGameInstance: jest.fn().mockReturnValue(game) } as any,
  };
}

describe('SimulationExecutionService', () => {
  it('runs sequential authoritative turns until the game ends', async () => {
    const { manager, game } = createFakeManager();
    const completed: number[] = [];

    await new SimulationExecutionService(manager).runToEnd('game', {
      maxTurns: 2,
      onTurnCompleted: turn => {
        completed.push(turn);
      },
    });

    expect(game.turnManager.processTurn).toBeDefined();
    expect(completed).toEqual([2]);
  });

  it('stops before mutating a cancelled run', async () => {
    const { manager } = createFakeManager();
    const controller = new AbortController();
    controller.abort();

    await expect(
      new SimulationExecutionService(manager).runToEnd('game', {
        maxTurns: 2,
        signal: controller.signal,
      })
    ).rejects.toMatchObject<Partial<SimulationExecutionError>>({ reason: 'cancelled' });
  });
});
