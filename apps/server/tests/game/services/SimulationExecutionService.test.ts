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

    expect(game.turnManager.getCurrentTurn()).toBe(2);
    expect(game.state).toBe('ended');
    expect(completed).toEqual([2]);
  });

  it('stops before mutating a cancelled run', async () => {
    const { manager, game } = createFakeManager();
    const controller = new AbortController();
    controller.abort();

    await expect(
      new SimulationExecutionService(manager).runToEnd('game', {
        maxTurns: 2,
        signal: controller.signal,
      })
    ).rejects.toMatchObject<Partial<SimulationExecutionError>>({ reason: 'cancelled' });
    expect(game.turnManager.getCurrentTurn()).toBe(1);
    expect(game.state).toBe('active');
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
    jest.useFakeTimers();
    jest.setSystemTime(1_000);
    const { manager, game } = createFakeManager();
    game.turnManager.processTurn = jest.fn(async () => {
      jest.setSystemTime(2_000);
      game.state = 'ended';
    });

    await expect(
      new SimulationExecutionService(manager).runToEnd('game', {
        maxTurns: 2,
        timeoutMs: 500,
      })
    ).rejects.toMatchObject<Partial<SimulationExecutionError>>({ reason: 'timeout' });
    jest.useRealTimers();
  });

  it('reports a missing game instance as a turn failure', async () => {
    const manager = { getGameInstance: jest.fn().mockReturnValue(undefined) } as any;

    await expect(
      new SimulationExecutionService(manager).runToEnd('missing', { maxTurns: 2 })
    ).rejects.toMatchObject<Partial<SimulationExecutionError>>({ reason: 'turn_failure' });
  });

  it('reports the exact max-turn boundary as a normal stop reason', async () => {
    const { manager, game } = createFakeManager();
    game.turnManager.processTurn = jest.fn(async () => {
      game.turnManager.currentTurn += 1;
    });

    await expect(
      new SimulationExecutionService(manager).runToEnd('game', { maxTurns: 1 })
    ).rejects.toMatchObject<Partial<SimulationExecutionError>>({ reason: 'max_turns' });
    expect(game.turnManager.getCurrentTurn()).toBe(2);
    expect(game.turnManager.processTurn).toHaveBeenCalledTimes(1);
  });

  it('maps an authoritative turn rejection to a turn failure', async () => {
    const { manager, game } = createFakeManager();
    game.turnManager.processTurn = jest.fn().mockRejectedValue(new Error('turn exploded'));

    await expect(
      new SimulationExecutionService(manager).runToEnd('game', { maxTurns: 2 })
    ).rejects.toMatchObject<Partial<SimulationExecutionError>>({
      reason: 'turn_failure',
      message: 'turn exploded',
    });
  });

  it('waits for an in-progress turn to acknowledge timeout before rejecting', async () => {
    jest.useFakeTimers();
    const { manager, game } = createFakeManager();
    let turnState: 'processing' | 'aborting' | 'stopped' = 'processing';
    let acknowledgeAbort = () => undefined;
    game.turnManager.processTurn = jest.fn(
      (signal?: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            turnState = 'aborting';
            acknowledgeAbort = () => {
              turnState = 'stopped';
              reject(signal.reason);
            };
          });
        })
    ) as any;

    const run = new SimulationExecutionService(manager).runToEnd('game', {
      maxTurns: 2,
      timeoutMs: 50,
    });
    let runState: 'pending' | 'settled' = 'pending';
    void run.then(
      () => {
        runState = 'settled';
      },
      () => {
        runState = 'settled';
      }
    );
    const expectation = expect(run).rejects.toMatchObject<Partial<SimulationExecutionError>>({
      reason: 'timeout',
    });
    await jest.advanceTimersByTimeAsync(50);

    expect(turnState).toBe('aborting');
    expect(runState).toBe('pending');
    acknowledgeAbort();
    await expectation;
    expect(turnState).toBe('stopped');
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
