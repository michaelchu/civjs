import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import { CLASSIC_EFFECT_COVERAGE } from '@game/services/ClassicEffectInventory';

describe('classic effect inventory', () => {
  it('classifies every shipped classic effect type', () => {
    const shipped = new Set(
      Object.values(rulesetLoader.getEffects()).map(effect => effect.type as string)
    );
    expect(new Set(Object.keys(CLASSIC_EFFECT_COVERAGE))).toEqual(shipped);
  });

  it('does not classify effect types that are absent from classic', () => {
    const shipped = new Set(
      Object.values(rulesetLoader.getEffects()).map(effect => effect.type as string)
    );
    for (const effectType of Object.keys(CLASSIC_EFFECT_COVERAGE)) {
      expect(shipped.has(effectType)).toBe(true);
    }
  });

  it('has an implemented runtime consumer for every shipped classic effect type', () => {
    expect(
      Object.entries(CLASSIC_EFFECT_COVERAGE)
        .filter(([, coverage]) => coverage.disposition !== 'implemented')
        .map(([effectType]) => effectType)
    ).toEqual([]);
  });
});
