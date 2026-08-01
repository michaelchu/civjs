import {
  hashSimulationState,
  HeadlessSimulationRunner,
  resolveSimulationEndReason,
} from '@game/services/HeadlessSimulationRunner';
import { GameReplayService } from '@game/services/GameReplayService';
import { SimulationExecutionError } from '@game/services/SimulationExecutionService';

describe('HeadlessSimulationRunner result metadata', () => {
  it('uses the failure reason instead of a previously persisted normal end reason', () => {
    expect(resolveSimulationEndReason('failed', 'max_turns', 'TURN_FAILURE')).toBe('turn_failure');
    expect(resolveSimulationEndReason('timed_out', 'max_turns', 'TIMEOUT')).toBe('timeout');
  });

  it('preserves the game end reason for completed runs', () => {
    expect(resolveSimulationEndReason('completed', 'conquest')).toBe('conquest');
  });

  it('emits a replacement failure when replay verification changes the final result', async () => {
    const runner = new HeadlessSimulationRunner({} as any, {} as any);
    jest
      .spyOn(runner as any, 'verifyReplayCheckpoints')
      .mockRejectedValue(new Error('checkpoint mismatch'));
    jest.spyOn(runner as any, 'pauseFailedRun').mockResolvedValue(undefined);
    const emitProgress = jest.fn();

    const outcome = await (runner as any).verifyExecutionOutcome(
      'game-id',
      'run-id',
      [],
      {
        status: 'timed_out',
        failure: { code: 'TIMEOUT', message: 'deadline exceeded' },
        aiSummaries: [],
      },
      emitProgress
    );

    expect(outcome).toMatchObject({
      status: 'failed',
      failure: { code: 'TURN_FAILURE', message: 'checkpoint mismatch' },
    });
    expect(emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'run_failed', code: 'TURN_FAILURE' })
    );
  });

  it('treats the max-turn boundary as a completed outcome', async () => {
    const runner = new HeadlessSimulationRunner({} as any, {} as any);
    const pauseFailedRun = jest.spyOn(runner as any, 'pauseFailedRun').mockResolvedValue(undefined);
    const emitProgress = jest.fn();
    const executionService = {
      runToEnd: jest
        .fn()
        .mockRejectedValue(new SimulationExecutionError('max_turns', 'cap reached')),
    };

    await expect(
      (runner as any).executeGame(
        'game-id',
        { config: { maxTurns: 2 }, runId: 'run-id' },
        executionService,
        emitProgress
      )
    ).resolves.toEqual({ status: 'completed', endReason: 'max_turns', aiSummaries: [] });
    expect(pauseFailedRun).not.toHaveBeenCalled();
    expect(emitProgress).not.toHaveBeenCalled();
  });

  it('observes one completed-turn summary without loading the full replay', async () => {
    const runner = new HeadlessSimulationRunner({} as any, {} as any);
    jest
      .spyOn(GameReplayService.prototype, 'getLatestCompletedTurn')
      .mockResolvedValue({ turn: 7, completedTurns: 7 });
    jest.spyOn(runner as any, 'readAISummaries').mockResolvedValue([]);
    const readReplay = jest.spyOn(runner as any, 'readReplay');
    const emitProgress = jest.fn();
    const summaries: unknown[] = [];

    await (runner as any).createTurnObserver('game-id', 'run-id', summaries, emitProgress)();

    expect(readReplay).not.toHaveBeenCalled();
    expect(summaries).toEqual([{ turn: 7, players: [] }]);
    expect(emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'turn_completed', turn: 7, completedTurns: 7 })
    );
  });

  it('verifies already-loaded checkpoints without replay queries per turn', async () => {
    const reconstructGameAtTurn = jest.fn();
    const runner = new HeadlessSimulationRunner({ reconstructGameAtTurn } as any, {} as any);
    const reconstructCheckpoint = jest
      .spyOn(GameReplayService.prototype, 'reconstructCheckpoint')
      .mockReturnValue({ turn: 1 } as any);
    const checkpoint = {
      id: 'turn-1',
      turn: 1,
      year: -4000,
      startedAt: new Date(),
      endedAt: new Date(),
      actions: {},
      statistics: {},
      snapshot: { version: 2, turn: 1 },
      phases: [],
      events: [],
    };

    await (runner as any).verifyReplayCheckpoints([checkpoint]);

    expect(reconstructCheckpoint).toHaveBeenCalledWith(checkpoint);
    expect(reconstructGameAtTurn).not.toHaveBeenCalled();
  });

  it('preserves gameplay ids and canonicalizes object key order in state hashes', () => {
    expect(hashSimulationState({ cities: [{ id: 'city-a' }], a: 1, B: 2 })).toBe(
      hashSimulationState({ B: 2, a: 1, cities: [{ id: 'city-a' }] })
    );
    expect(hashSimulationState({ cities: [{ id: 'city-a' }] })).not.toBe(
      hashSimulationState({ cities: [{ id: 'city-b' }] })
    );
  });

  it('canonicalizes random UUID suffixes on ordered gameplay ids', () => {
    expect(
      hashSimulationState({
        players: [{ id: '00000001-1111-4111-8111-111111111111' }],
      })
    ).toBe(
      hashSimulationState({
        players: [{ id: '00000001-2222-4222-8222-222222222222' }],
      })
    );
    expect(
      hashSimulationState({
        players: [{ id: '00000001-1111-4111-8111-111111111111' }],
      })
    ).not.toBe(
      hashSimulationState({
        players: [{ id: '00000002-1111-4111-8111-111111111111' }],
      })
    );
    expect(
      hashSimulationState({
        research: {
          '00000001-1111-4111-8111-111111111111': {
            playerId: '00000001-1111-4111-8111-111111111111',
          },
        },
      })
    ).toBe(
      hashSimulationState({
        research: {
          '00000001-2222-4222-8222-222222222222': {
            playerId: '00000001-2222-4222-8222-222222222222',
          },
        },
      })
    );
  });

  it('ignores wall-clock timestamps in deterministic state hashes', () => {
    expect(
      hashSimulationState({
        events: [{ eventData: { timestamp: 1_000 } }],
      })
    ).toBe(
      hashSimulationState({
        events: [{ eventData: { timestamp: 2_000 } }],
      })
    );
  });

  it('canonicalizes ordered UUIDs embedded in diagnostic labels', () => {
    expect(
      hashSimulationState({
        survivingTeams: ['player:00000001-1111-4111-8111-111111111111'],
      })
    ).toBe(
      hashSimulationState({
        survivingTeams: ['player:00000001-2222-4222-8222-222222222222'],
      })
    );
  });
});
