export type GameSessionPhase =
  | 'idle'
  | 'connecting'
  | 'authenticating'
  | 'joining'
  | 'syncing'
  | 'ready'
  | 'reconnecting'
  | 'error';

export type GameSessionTarget =
  | {
      role: 'player';
      gameId: string;
      playerName: string;
      selectedNation: string;
    }
  | {
      role: 'observer';
      gameId: string;
    };

export interface GameSessionState {
  phase: GameSessionPhase;
  target: GameSessionTarget | null;
  error: string | null;
}

/**
 * Owns session intent independently from the Socket.IO transport.
 *
 * Operation tokens prevent late acknowledgements from a cancelled or superseded
 * join from changing the active session.
 */
export class GameSessionCoordinator {
  private state: GameSessionState = {
    phase: 'idle',
    target: null,
    error: null,
  };

  private operation = 0;

  getState(): Readonly<GameSessionState> {
    return this.state;
  }

  connecting(): void {
    this.update({ phase: 'connecting', error: null });
  }

  begin(target: GameSessionTarget): number {
    const operation = ++this.operation;
    this.state = {
      phase: target.role === 'player' ? 'authenticating' : 'joining',
      target,
      error: null,
    };
    return operation;
  }

  transition(operation: number, phase: 'authenticating' | 'joining' | 'syncing'): boolean {
    if (!this.isCurrent(operation)) return false;
    this.update({ phase });
    return true;
  }

  ready(operation: number): boolean {
    if (!this.isCurrent(operation)) return false;
    this.update({ phase: 'ready', error: null });
    return true;
  }

  fail(operation: number, error: unknown): boolean {
    if (!this.isCurrent(operation)) return false;
    this.update({
      phase: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
    return true;
  }

  disconnected(): GameSessionTarget | null {
    ++this.operation;
    if (this.state.target) {
      this.update({ phase: 'reconnecting', error: null });
    } else {
      this.update({ phase: 'idle', error: null });
    }
    return this.state.target;
  }

  cancel(): void {
    ++this.operation;
    this.state = {
      phase: 'idle',
      target: null,
      error: null,
    };
  }

  isCurrent(operation: number): boolean {
    return operation === this.operation;
  }

  private update(update: Partial<GameSessionState>): void {
    this.state = { ...this.state, ...update };
  }
}
