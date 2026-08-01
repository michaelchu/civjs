import { resolveSimulationEndReason } from '@game/services/HeadlessSimulationRunner';

describe('HeadlessSimulationRunner result metadata', () => {
  it('uses the failure reason instead of a previously persisted normal end reason', () => {
    expect(resolveSimulationEndReason('failed', 'max_turns', 'TURN_FAILURE')).toBe('turn_failure');
    expect(resolveSimulationEndReason('timed_out', 'max_turns', 'TIMEOUT')).toBe('timeout');
  });

  it('preserves the game end reason for completed runs', () => {
    expect(resolveSimulationEndReason('completed', 'conquest')).toBe('conquest');
  });
});
