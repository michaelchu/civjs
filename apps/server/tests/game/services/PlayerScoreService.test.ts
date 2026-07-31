import {
  calculatePlayerScore,
  calculatePlayerScoreBreakdown,
  resolvePlayerScore,
} from '@game/services/PlayerScoreService';

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

  it('keeps specialists inside citizen count and exposes every score contribution', () => {
    const breakdown = calculatePlayerScoreBreakdown({
      cities: [{ population: 5, specialists: { scientist: 2 }, buildings: ['wonder'] }],
      researchedTechs: ['pottery', 'future_tech_1'],
      greatWonders: 1,
      unitsBuilt: 19,
      unitsKilled: 8,
      history: 99,
      spaceship: { arrivalTurn: 10, population: 20, successRate: 50 },
      currentTurn: 10,
    });

    expect(breakdown).toEqual({
      population: 5,
      technologies: 6,
      wonders: 5,
      spaceship: 10,
      unitsBuilt: 1,
      unitsKilled: 2,
      culture: 1,
      total: 30,
    });
  });

  it('uses persisted score only when a live snapshot is unavailable', () => {
    expect(resolvePlayerScore(275)).toBe(275);
    expect(
      resolvePlayerScore(275, { cities: [], units: [], researchedTechs: [], history: 0 })
    ).toBe(0);
    expect(resolvePlayerScore(undefined)).toBe(0);
  });
});
