import { calculatePlayerScore, resolvePlayerScore } from '@game/services/PlayerScoreService';

describe('PlayerScoreService', () => {
  it('calculates the score from authoritative game collections', () => {
    expect(
      calculatePlayerScore({
        cities: [{ population: 4 }, { size: 2 }],
        units: [{}, {}, {}],
        researchedTechs: ['pottery', 'writing'],
        history: 7,
      })
    ).toBe(427);
  });

  it('uses persisted score only when a live snapshot is unavailable', () => {
    expect(resolvePlayerScore(275)).toBe(275);
    expect(
      resolvePlayerScore(275, { cities: [], units: [], researchedTechs: [], history: 0 })
    ).toBe(0);
    expect(resolvePlayerScore(undefined)).toBe(0);
  });
});
