/**
 * @module server/game/runtime/GameOperationLock
 * Serializes mutable lobby operations for one game at a time.
 */
export class GameOperationLock {
  private locks = new Map<string, Promise<void>>();

  async run<T>(gameId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(gameId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => {
      release = resolve;
    });
    this.locks.set(gameId, current);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(gameId) === current) this.locks.delete(gameId);
    }
  }

  clear(): void {
    this.locks.clear();
  }
}
