import { describe, expect, it } from 'vitest';
import { GameSessionCoordinator, type GameSessionTarget } from '../GameSessionCoordinator';

const playerTarget: GameSessionTarget = {
  role: 'player',
  gameId: 'game-1',
  playerName: 'Ada',
  selectedNation: 'roman',
};

describe('GameSessionCoordinator', () => {
  it('models a player session through authentication, snapshot sync, and readiness', () => {
    const session = new GameSessionCoordinator();

    session.connecting();
    expect(session.getState().phase).toBe('connecting');

    const operation = session.begin(playerTarget);
    expect(session.getState()).toMatchObject({
      phase: 'authenticating',
      target: playerTarget,
    });

    expect(session.transition(operation, 'joining')).toBe(true);
    expect(session.transition(operation, 'syncing')).toBe(true);
    expect(session.ready(operation)).toBe(true);
    expect(session.getState().phase).toBe('ready');
  });

  it('retains session intent across a transport disconnect', () => {
    const session = new GameSessionCoordinator();
    const operation = session.begin(playerTarget);
    session.ready(operation);

    expect(session.disconnected()).toEqual(playerTarget);
    expect(session.getState()).toEqual({
      phase: 'reconnecting',
      target: playerTarget,
      error: null,
    });
  });

  it('ignores late acknowledgements after cancellation', () => {
    const session = new GameSessionCoordinator();
    const operation = session.begin(playerTarget);

    session.cancel();

    expect(session.ready(operation)).toBe(false);
    expect(session.fail(operation, new Error('late failure'))).toBe(false);
    expect(session.getState()).toEqual({
      phase: 'idle',
      target: null,
      error: null,
    });
  });

  it('records failures only for the active operation', () => {
    const session = new GameSessionCoordinator();
    const staleOperation = session.begin(playerTarget);
    const activeOperation = session.begin({ role: 'observer', gameId: 'game-2' });

    expect(session.fail(staleOperation, new Error('stale'))).toBe(false);
    expect(session.fail(activeOperation, new Error('snapshot failed'))).toBe(true);
    expect(session.getState()).toMatchObject({
      phase: 'error',
      error: 'snapshot failed',
    });
  });
});
