import {
  HeadlessSimulationRunner,
  resolveSimulationEndReason,
} from '@game/services/HeadlessSimulationRunner';

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
});
