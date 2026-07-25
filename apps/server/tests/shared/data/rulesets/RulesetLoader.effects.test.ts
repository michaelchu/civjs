import { join } from 'path';
import { RulesetLoader } from '@shared/data/rulesets/RulesetLoader';

describe('RulesetLoader classic effects ruleset', () => {
  const createLoader = () => new RulesetLoader(join(process.cwd(), 'src/shared/data/rulesets'));

  it('loads every supported classic ruleset data file', () => {
    const loader = createLoader();

    expect(loader.loadTerrainRuleset()).toBeDefined();
    expect(loader.loadBuildingsRuleset()).toBeDefined();
    expect(loader.loadTechsRuleset()).toBeDefined();
    expect(loader.loadUnitsRuleset()).toBeDefined();
    expect(loader.loadGovernmentsRuleset()).toBeDefined();
    expect(loader.loadGameRulesRuleset()).toBeDefined();
    expect(loader.loadEffectsRuleset()).toBeDefined();
    expect(loader.loadNationsRuleset()).toBeDefined();
    expect(loader.loadCitiesRuleset()).toBeDefined();
  });

  it('loads the anarchy corruption effects ported from the classic ruleset', () => {
    const loader = createLoader();

    const effects = loader.loadEffectsRuleset();

    // @reference reference/freeciv/data/classic/effects.ruleset:262-278
    expect(effects.effects.corruption_anarchy_base).toMatchObject({
      id: 'corruption_anarchy_base',
      type: 'Output_Waste',
      value: 25,
    });
    expect(effects.effects.corruption_anarchy_distance).toMatchObject({
      id: 'corruption_anarchy_distance',
      type: 'Output_Waste_By_Distance',
      value: 200,
    });
  });
});
