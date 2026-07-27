import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import { CLASSIC_GAME_RULE_COVERAGE } from '@game/services/ClassicGameRuleInventory';

describe('classic game rule inventory', () => {
  it('classifies every converted top-level game.ruleset section', () => {
    const rules = rulesetLoader.loadGameRulesRuleset();

    expect(Object.keys(CLASSIC_GAME_RULE_COVERAGE).sort()).toEqual(Object.keys(rules).sort());
  });

  it('gives every partial section an explicit remaining-gap list', () => {
    for (const coverage of Object.values(CLASSIC_GAME_RULE_COVERAGE)) {
      if (coverage.disposition === 'partial') {
        expect(coverage.remaining?.length).toBeGreaterThan(0);
      }
      expect(coverage.consumer).not.toHaveLength(0);
    }
  });
});
