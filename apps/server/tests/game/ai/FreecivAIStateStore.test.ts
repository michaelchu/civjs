import { normalizeAIState } from '@game/ai/FreecivAIStateStore';

describe('Freeciv AI state', () => {
  it('normalizes legacy or absent player state', () => {
    expect(normalizeAIState(undefined)).toEqual({
      version: 1,
      lastProcessedTurn: undefined,
      lastDecisionCount: undefined,
      diplomacy: {},
      unitTasks: {},
      cityWants: {},
      techWants: {},
    });
  });

  it('retains persisted planning memory while repairing missing collections', () => {
    expect(
      normalizeAIState({
        version: 1,
        lastProcessedTurn: 12,
        diplomacy: { opponent: { love: -50, warDesire: 30, countdown: 4 } },
      })
    ).toEqual({
      version: 1,
      lastProcessedTurn: 12,
      lastDecisionCount: undefined,
      diplomacy: { opponent: { love: -50, warDesire: 30, countdown: 4 } },
      unitTasks: {},
      cityWants: {},
      techWants: {},
    });
  });
});
