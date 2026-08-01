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

  it('reports cancellation requested during a turn at the completed boundary', async () => {
    const { manager, game } = createFakeManager();
    const controller = new AbortController();
    game.turnManager.processTurn = jest.fn(async () => {
      controller.abort();
      game.state = 'ended';
    });

    await expect(
      new SimulationExecutionService(manager).runToEnd('game', {
        maxTurns: 2,
        signal: controller.signal,
      })
    ).rejects.toMatchObject<Partial<SimulationExecutionError>>({ reason: 'cancelled' });
  });

  it('reports a deadline crossed by the final turn as a timeout', async () => {
    const { manager } = createFakeManager();
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValueOnce(1_000).mockReturnValueOnce(1_000).mockReturnValue(2_000);

    await expect(
      new SimulationExecutionService(manager).runToEnd('game', {
        maxTurns: 2,
        timeoutMs: 500,
      })
    ).rejects.toMatchObject<Partial<SimulationExecutionError>>({ reason: 'timeout' });
    now.mockRestore();
  });

  it('bounds a turn that does not settle', async () => {
    jest.useFakeTimers();
    const { manager, game } = createFakeManager();
    game.turnManager.processTurn = jest.fn(() => new Promise<void>(() => undefined));

    const run = new SimulationExecutionService(manager).runToEnd('game', {
      maxTurns: 2,
      timeoutMs: 50,
    });
    const expectation = expect(run).rejects.toMatchObject<Partial<SimulationExecutionError>>({
      reason: 'timeout',
    });
    await jest.advanceTimersByTimeAsync(50);

    await expectation;
    jest.useRealTimers();
  });

  it('classifies post-turn diagnostics failures as turn failures', async () => {
    const { manager } = createFakeManager();

    await expect(
      new SimulationExecutionService(manager).runToEnd('game', {
        maxTurns: 2,
        onTurnCompleted: () => {
          throw new Error('replay unavailable');
        },
      })
    ).rejects.toMatchObject<Partial<SimulationExecutionError>>({
      reason: 'turn_failure',
      message: 'Post-turn processing failed: replay unavailable',
    });
  });
});
