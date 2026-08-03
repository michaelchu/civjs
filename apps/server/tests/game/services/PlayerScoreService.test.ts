import {
  calculatePlayerScore,
  calculatePlayerScoreBreakdown,
  resolvePlayerScore,
} from '@game/services/PlayerScoreService';

describe('calculatePlayerScore', () => {
  /**
   * @evidence parity
   * @reference reference/freeciv/server/score.c:312-361
   * @assertion Citizen, technology, wonder, unit, and culture score categories use the reference weights and integer truncation.
   */
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

  /**
   * @evidence parity
   * @reference reference/freeciv/server/score.c:367-375
   * @assertion A spaceship contributes to civilization score only after arrival, as population times success rate divided by 100.
   */
  it('scores only an arrived spaceship and applies its success rate', () => {
    const state = { arrivalYear: 2000, population: 100, successRate: 75 };
    expect(calculatePlayerScore({ spaceship: state, currentYear: 1999 })).toBe(0);
    expect(calculatePlayerScore({ spaceship: state, currentYear: 2000 })).toBe(75);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/server/score.c:312-320
   * @reference reference/freeciv/server/score.c:352-361
   * @assertion Future technologies use the reference five-halves adjustment before the technology score multiplier.
   */
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
      spaceship: { status: 'arrived', population: 20, successRate: 50 },
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
