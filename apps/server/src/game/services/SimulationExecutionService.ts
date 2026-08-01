import type { GameManager } from '@game/managers/GameManager';

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
    const deadline = options.timeoutMs ? Date.now() + options.timeoutMs : undefined;
    const game = this.gameManager.getGameInstance(gameId);
    if (!game)
      throw new SimulationExecutionError('turn_failure', 'Simulation game instance is missing');

    while (game.state === 'active') {
      if (options.signal?.aborted) {
        throw new SimulationExecutionError('cancelled', 'Simulation was cancelled');
      }
      if (deadline !== undefined && Date.now() >= deadline) {
        throw new SimulationExecutionError('timeout', 'Simulation exceeded its timeout');
      }
      if (game.turnManager.getCurrentTurn() > options.maxTurns) {
        throw new SimulationExecutionError(
          'turn_failure',
          `Simulation remained active after max turn ${options.maxTurns}`
        );
      }

      const turnAbortController = new AbortController();
      const stopTurn = createTurnStopPromise(turnAbortController, options.signal, deadline);
      try {
        await Promise.race([
          game.turnManager.processTurn(turnAbortController.signal),
          stopTurn.promise,
        ]);
      } catch (error) {
        if (error instanceof SimulationExecutionError) throw error;
        throw new SimulationExecutionError(
          'turn_failure',
          error instanceof Error ? error.message : String(error)
        );
      } finally {
        stopTurn.cleanup();
      }
      if (options.signal?.aborted) {
        throw new SimulationExecutionError('cancelled', 'Simulation was cancelled');
      }
      if (deadline !== undefined && Date.now() >= deadline) {
        throw new SimulationExecutionError('timeout', 'Simulation exceeded its timeout');
      }
      try {
        await options.onTurnCompleted?.(game.turnManager.getCurrentTurn());
      } catch (error) {
        throw new SimulationExecutionError(
          'turn_failure',
          `Post-turn processing failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
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
