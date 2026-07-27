import { NATION_COLOR_THEMES } from '@utils/playerColors';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';

describe('classic player color palette', () => {
  it('uses the ordered playercolors table from game.ruleset', () => {
    const configured = rulesetLoader.loadGameRulesRuleset().player_colors.colorlist;

    expect(NATION_COLOR_THEMES.map(theme => theme.primary)).toEqual(configured);
  });
});
