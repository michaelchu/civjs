import { EffectsManager, EffectType } from '@game/managers/EffectsManager';
import { CalendarService } from '@game/services/CalendarService';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';

describe('classic ruleset calendar', () => {
  const effects = new EffectsManager();

  it.each([
    [-4000, 50],
    [-1000, 25],
    [0, 20],
    [1000, 10],
    [1500, 5],
    [1750, 2],
    [1900, 1],
  ])('advances %i by %i years before timeline slowdown', (currentYear, expectedYears) => {
    expect(
      effects.calculateEffect(EffectType.TURN_YEARS, {
        currentYear,
        playerTechs: new Set(),
      }).value
    ).toBe(expectedYears);
  });

  it('accumulates the three classic world-technology slowdown effects', () => {
    expect(
      effects.calculateEffect(EffectType.SLOW_DOWN_TIMELINE, {
        currentYear: 1900,
        playerTechs: new Set(['plastics', 'superconductors', 'space_flight']),
      }).value
    ).toBe(3);
  });

  it('constructs labels and starting year from game.ruleset', () => {
    const calendar = new CalendarService(
      CalendarService.createRulesetConfig(rulesetLoader.getCalendarRules())
    );

    expect(calendar.getState().year).toBe(-4000);
    expect(calendar.formatYear(-1)).toBe('1 BCE');
    expect(calendar.formatYear(1)).toBe('1 CE');
  });
});
