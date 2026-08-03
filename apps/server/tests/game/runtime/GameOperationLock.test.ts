/**
 * @module tests/game/runtime/GameOperationLock
 * Covers serialization of mutable lobby operations.
 */
import { GameOperationLock } from '@game/runtime/GameOperationLock';

describe('GameOperationLock', () => {
  /**
   * @evidence stack
   * @contract Game operations for one game are serialized before mutation begins.
   * @assertion A join/start operation for one game cannot observe another operation halfway through.
   */
  it('serializes operations for the same game', async () => {
    const lock = new GameOperationLock();
    const events: string[] = [];

    let releaseFirst!: () => void;
    const firstRelease = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    let firstStarted!: () => void;
    const firstStartedPromise = new Promise<void>(resolve => {
      firstStarted = resolve;
    });

    const first = lock.run('game-1', async () => {
      events.push('first-start');
      firstStarted();
      await firstRelease;
      events.push('first-end');
    });

    await firstStartedPromise;
    const second = lock.run('game-1', async () => {
      events.push('second-start');
    });

    await Promise.resolve();
    expect(events).toEqual(['first-start']);

    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first-start', 'first-end', 'second-start']);
  });
});
