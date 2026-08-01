import type { GameInstance, GameManager } from '@game/managers/GameManager';

export type SimulationExecutionStopReason = 'turn_failure' | 'timeout' | 'cancelled';

export class SimulationExecutionError extends Error {
  constructor(
    readonly reason: SimulationExecutionStopReason,
    message: string
  ) {
    super(message);
    this.name = 'SimulationExecutionError';
  }
}

export interface SimulationExecutionOptions {
  maxTurns: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onTurnCompleted?: (turn: number) => void | Promise<void>;
}

/**
 * Shared authoritative turn loop for headless execution and the future live
 * simulation scheduler. It intentionally delegates the actual turn to the
 * existing TurnManager, preserving leases, phases, AI processing, replay
 * checkpoints, scores, and end-game evaluation.
 */
export class SimulationExecutionService {
  constructor(private readonly gameManager: GameManager) {}

  async runToEnd(gameId: string, options: SimulationExecutionOptions): Promise<void> {
    const deadline = createDeadline(options.timeoutMs);
    const game = this.requireGame(gameId);

    while (game.state === 'active') {
      this.assertCanStartTurn(game, options, deadline);
      await this.processTurn(game, options.signal, deadline);
      this.assertNotStopped(options.signal, deadline);
      await this.notifyTurnCompleted(game, options.onTurnCompleted);
    }
  }

  private requireGame(gameId: string): GameInstance {
    const game = this.gameManager.getGameInstance(gameId);
    if (game) return game;
    throw new SimulationExecutionError('turn_failure', 'Simulation game instance is missing');
  }

  private assertCanStartTurn(
    game: GameInstance,
    options: SimulationExecutionOptions,
    deadline: number | undefined
  ): void {
    this.assertNotStopped(options.signal, deadline);
    if (game.turnManager.getCurrentTurn() <= options.maxTurns) return;
    throw new SimulationExecutionError(
      'turn_failure',
      `Simulation remained active after max turn ${options.maxTurns}`
    );
  }

  private assertNotStopped(signal: AbortSignal | undefined, deadline: number | undefined): void {
    if (signal?.aborted) {
      throw new SimulationExecutionError('cancelled', 'Simulation was cancelled');
    }
    if (deadline !== undefined && Date.now() >= deadline) {
      throw new SimulationExecutionError('timeout', 'Simulation exceeded its timeout');
    }
  }

  private async processTurn(
    game: GameInstance,
    signal: AbortSignal | undefined,
    deadline: number | undefined
  ): Promise<void> {
    const turnAbortController = new AbortController();
    const stopTurn = createTurnStopPromise(turnAbortController, signal, deadline);
    const turnProcessing = game.turnManager.processTurn(turnAbortController.signal);
    try {
      await Promise.race([turnProcessing, stopTurn.promise]);
    } catch (error) {
      await this.rethrowAfterTurnQuiesces(error, turnProcessing, turnAbortController.signal);
    } finally {
      stopTurn.cleanup();
    }
  }

  private async rethrowAfterTurnQuiesces(
    error: unknown,
    turnProcessing: Promise<void>,
    turnSignal: AbortSignal
  ): Promise<never> {
    if (turnSignal.aborted) {
      await settleIgnoringFailure(turnProcessing);
      if (turnSignal.reason instanceof SimulationExecutionError) throw turnSignal.reason;
    }
    if (error instanceof SimulationExecutionError) {
      await settleIgnoringFailure(turnProcessing);
      throw error;
    }
    throw new SimulationExecutionError('turn_failure', errorMessage(error));
  }

  private async notifyTurnCompleted(
    game: GameInstance,
    onTurnCompleted: SimulationExecutionOptions['onTurnCompleted']
  ): Promise<void> {
    try {
      await onTurnCompleted?.(game.turnManager.getCurrentTurn());
    } catch (error) {
      throw new SimulationExecutionError(
        'turn_failure',
        `Post-turn processing failed: ${errorMessage(error)}`
      );
    }
  }
}

function createDeadline(timeoutMs: number | undefined): number | undefined {
  return timeoutMs ? Date.now() + timeoutMs : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function settleIgnoringFailure(promise: Promise<void>): Promise<void> {
  try {
    await promise;
  } catch {
    // The timeout/cancellation reason remains authoritative after abort acknowledgement.
  }
}

function createTurnStopPromise(
  turnAbortController: AbortController,
  signal: AbortSignal | undefined,
  deadline: number | undefined
): { promise: Promise<never>; cleanup: () => void } {
  let timeout: NodeJS.Timeout | undefined;
  let rejectStop: (error: SimulationExecutionError) => void = () => undefined;
  const promise = new Promise<never>((_resolve, reject) => {
    rejectStop = reject;
  });
  const stop = (error: SimulationExecutionError) => {
    rejectStop(error);
    turnAbortController.abort(error);
  };
  const cancel = () => stop(new SimulationExecutionError('cancelled', 'Simulation was cancelled'));
  signal?.addEventListener('abort', cancel, { once: true });
  if (deadline !== undefined) {
    timeout = setTimeout(
      () => stop(new SimulationExecutionError('timeout', 'Simulation exceeded its timeout')),
      Math.max(0, deadline - Date.now())
    );
  }
  return {
    promise,
    cleanup: () => {
      if (timeout) clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
    },
  };
}
