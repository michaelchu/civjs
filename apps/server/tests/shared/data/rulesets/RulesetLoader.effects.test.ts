import { join } from 'path';
import { RulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import { EffectsRulesetFileSchema } from '@shared/data/rulesets/schemas';

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

  it('loads the classic city building output and contentment effects', () => {
    const effects = createLoader().loadEffectsRuleset().effects;

    // @reference reference/freeciv/data/classic/effects.ruleset:1175-1199,1764-1781,953-980
    expect(effects.library_science_bonus).toMatchObject({ type: 'Output_Bonus', value: 100 });
    expect(effects.marketplace_gold_bonus).toMatchObject({ type: 'Output_Bonus', value: 50 });
    expect(effects.temple_content).toMatchObject({ type: 'Make_Content', value: 1 });
    expect(effects.temple_mysticism_content).toMatchObject({ type: 'Make_Content', value: 1 });
    expect(effects.cathedral_content).toMatchObject({ type: 'Make_Content', value: 3 });
    expect(effects.cathedral_theology_content).toMatchObject({ type: 'Make_Content', value: 1 });
    expect(effects.cathedral_communism_content).toMatchObject({ type: 'Make_Content', value: -1 });
    expect(effects.city_walls_defense).toMatchObject({ type: 'Defend_Bonus', value: 200 });
    expect(effects.city_walls_helicopter_defense).toMatchObject({
      type: 'Defend_Bonus',
      value: 200,
    });
    // @reference reference/freeciv/data/classic/effects.ruleset:1020-1028
    expect(effects.courthouse_trade_waste).toMatchObject({ type: 'Output_Waste_Pct', value: 50 });
    // @reference reference/freeciv/data/classic/effects.ruleset:1038-1045
    expect(effects.courthouse_democracy_content).toMatchObject({ type: 'Make_Content', value: 1 });
    // @reference reference/freeciv/data/classic/effects.ruleset:1097-1110
    expect(effects.granary_growth_food).toMatchObject({ type: 'Growth_Food', value: 50 });
    expect(effects.granary_shrink_food).toMatchObject({ type: 'Shrink_Food', value: 50 });
  });

  it('rejects effects with requirement types that the runtime cannot evaluate', () => {
    const loader = createLoader();
    const effects = loader.loadEffectsRuleset();
    const invalidEffects = structuredClone(effects);
    invalidEffects.effects.corruption_anarchy_base.reqs = [
      // @reference reference/freeciv/common/requirements.c:6495-6535
      // Requirements must have a matching evaluator before they can affect play.
      { type: 'UnsupportedRequirement', name: 'anything', range: 'Local' },
    ] as never;

    expect(EffectsRulesetFileSchema.safeParse(invalidEffects).success).toBe(false);
  });
});
