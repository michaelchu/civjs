import { calculatePlayerScore, resolvePlayerScore } from '@game/services/PlayerScoreService';

describe('calculatePlayerScore', () => {
  it('uses reference category weights and integer truncation', () => {
    expect(
      calculatePlayerScore({
        cities: [{ size: 7 }, { size: 3 }],
        researchedTechs: ['alphabet', 'future_tech_1', 'future_tech_2'],
        greatWonders: 2,
        unitsBuilt: 19,
        unitsKilled: 8,
        history: 99,
      })
    ).toBe(10 + 6 * 2 + 10 + 1 + 2 + 1);
  });

  it('scores only an arrived spaceship and applies its success rate', () => {
    const state = { arrivalTurn: 20, population: 100, successRate: 75 };
    expect(calculatePlayerScore({ spaceship: state, currentTurn: 19 })).toBe(0);
    expect(calculatePlayerScore({ spaceship: state, currentTurn: 20 })).toBe(75);
  });

  it('does not count future technologies as full technologies', () => {
    expect(calculatePlayerScore({ researchedTechs: ['future_tech_1'] })).toBe(4);
  });

  it('uses persisted score only when a live snapshot is unavailable', () => {
    expect(resolvePlayerScore(275)).toBe(275);
    expect(
      resolvePlayerScore(275, { cities: [], units: [], researchedTechs: [], history: 0 })
    ).toBe(0);
    expect(resolvePlayerScore(undefined)).toBe(0);
  });
});
