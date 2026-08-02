import { join } from 'path';
import { RulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import { EffectsRulesetFileSchema } from '@shared/data/rulesets/schemas';
import { EffectsManager, EffectType } from '@game/managers/EffectsManager';

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
      reqs: expect.arrayContaining([{ type: 'OutputType', name: 'Trade', range: 'Local' }]),
    });
    expect(effects.effects.corruption_anarchy_distance).toMatchObject({
      id: 'corruption_anarchy_distance',
      type: 'Output_Waste_By_Distance',
      value: 200,
      reqs: expect.arrayContaining([{ type: 'OutputType', name: 'Trade', range: 'Local' }]),
    });
  });

  it('loads the base city history effect used for culture border expansion', () => {
    const effects = createLoader().loadEffectsRuleset().effects;

    expect(effects.base_city_history).toMatchObject({
      id: 'base_city_history',
      type: 'History',
      value: 1,
      reqs: [],
    });
  });

  it('applies base city history through the effects manager', () => {
    const effectsManager = new EffectsManager('classic');

    expect(
      effectsManager.calculateEffect(EffectType.HISTORY, {
        cityId: 'city-1',
        playerId: 'player-1',
        cityBuildings: new Set(),
      }).value
    ).toBe(1);
  });

  it('loads every classic government effect used by the playable loop', () => {
    const effects = createLoader().loadEffectsRuleset().effects;

    // @reference reference/freeciv/data/classic/effects.ruleset:254-260,343-392
    expect(effects.republic_military_content).toMatchObject({
      type: 'Make_Content_Mil',
      value: 1,
      reqs: [{ type: 'Gov', name: 'Republic', range: 'Player' }],
    });
    expect(effects.base_unit_upkeep_not_gold).toMatchObject({
      type: 'Upkeep_Pct',
      value: 100,
      reqs: [{ type: 'OutputType', name: 'Gold', range: 'Local', present: false }],
    });
    expect(effects.base_unit_upkeep_gold).toMatchObject({
      type: 'Upkeep_Pct',
      value: 100,
      reqs: [
        { type: 'OutputType', name: 'Gold', range: 'Local' },
        { type: 'UnitState', name: 'HasHomeCity', range: 'Local' },
      ],
    });
    expect(effects.republic_unit_upkeep).toMatchObject({
      type: 'Upkeep_Pct',
      value: 100,
      reqs: [
        { type: 'Gov', name: 'Republic', range: 'Player' },
        { type: 'OutputType', name: 'Food', range: 'Local' },
      ],
    });
    expect(effects.democracy_unit_upkeep).toMatchObject({
      type: 'Upkeep_Pct',
      value: 100,
      reqs: [
        { type: 'Gov', name: 'Democracy', range: 'Player' },
        { type: 'OutputType', name: 'Food', range: 'Local' },
      ],
    });
    expect(effects.republic_unit_unhappiness).toMatchObject({
      type: 'Unhappy_Factor',
      value: 1,
      reqs: [{ type: 'Gov', name: 'Republic', range: 'Player' }],
    });
    expect(effects.democracy_unit_unhappiness).toMatchObject({
      type: 'Unhappy_Factor',
      value: 2,
      reqs: [{ type: 'Gov', name: 'Democracy', range: 'Player' }],
    });

    // @reference reference/freeciv/data/classic/effects.ruleset:759-781
    expect(effects.democracy_revolution_unhappiness).toMatchObject({
      type: 'Revolution_Unhappiness',
      value: 2,
      reqs: [{ type: 'Gov', name: 'Democracy', range: 'Player' }],
    });
    expect(effects.republic_senate).toMatchObject({
      type: 'Has_Senate',
      value: 1,
      reqs: [{ type: 'Gov', name: 'Republic', range: 'Player' }],
    });
    expect(effects.democracy_senate).toMatchObject({
      type: 'Has_Senate',
      value: 1,
      reqs: [{ type: 'Gov', name: 'Democracy', range: 'Player' }],
    });

    // @reference reference/freeciv/data/classic/effects.ruleset:1383-1401,2201-2217
    expect(effects.police_station_republic_military_content).toMatchObject({
      type: 'Make_Content_Mil',
      value: 1,
      reqs: [
        { type: 'Gov', name: 'Republic', range: 'Player', present: true },
        { type: 'Building', name: 'Police Station', range: 'City', present: true },
        {
          type: 'Building',
          name: "Women's Suffrage",
          range: 'Player',
          present: false,
        },
      ],
    });
    expect(effects.police_station_democracy_military_content).toMatchObject({
      type: 'Make_Content_Mil',
      value: 2,
      reqs: [
        { type: 'Gov', name: 'Democracy', range: 'Player', present: true },
        { type: 'Building', name: 'Police Station', range: 'City', present: true },
        {
          type: 'Building',
          name: "Women's Suffrage",
          range: 'Player',
          present: false,
        },
      ],
    });
    expect(effects.womens_suffrage_republic_military_content).toMatchObject({
      type: 'Make_Content_Mil',
      value: 1,
      reqs: [
        { type: 'Gov', name: 'Republic', range: 'Player' },
        { type: 'Building', name: "Women's Suffrage", range: 'Player' },
      ],
    });
    expect(effects.womens_suffrage_democracy_military_content).toMatchObject({
      type: 'Make_Content_Mil',
      value: 2,
      reqs: [
        { type: 'Gov', name: 'Democracy', range: 'Player' },
        { type: 'Building', name: "Women's Suffrage", range: 'Player' },
      ],
    });
  });

  it('restricts every classic corruption base and distance effect to trade', () => {
    const effects = createLoader().loadEffectsRuleset().effects;
    const corruptionEffectIds = [
      'corruption_anarchy_base',
      'corruption_anarchy_distance',
      'corruption_despotism_base',
      'corruption_despotism_distance',
      'corruption_monarchy_base',
      'corruption_monarchy_distance',
      'corruption_communism_base',
      'corruption_republic_base',
      'corruption_republic_distance',
    ];

    // @reference reference/freeciv/data/classic/effects.ruleset:262-341
    for (const effectId of corruptionEffectIds) {
      expect(effects[effectId].reqs).toContainEqual({
        type: 'OutputType',
        name: 'Trade',
        range: 'Local',
      });
    }
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/classic/effects.ruleset:157-173
   * @reference reference/freeciv/data/classic/effects.ruleset:904-925
   * @reference reference/freeciv/data/classic/effects.ruleset:953-980
   * @reference reference/freeciv/data/classic/effects.ruleset:1020-1045
   * @reference reference/freeciv/data/classic/effects.ruleset:1097-1110
   * @reference reference/freeciv/data/classic/effects.ruleset:1175-1201
   * @reference reference/freeciv/data/classic/effects.ruleset:1314-1379
   * @reference reference/freeciv/data/classic/effects.ruleset:1764-1781
   * @assertion Converted city-building effects retain the referenced classic effect type and value for output, contentment, defense, growth, and corruption.
   */
  it('loads the classic city building output and contentment effects', () => {
    const effects = createLoader().loadEffectsRuleset().effects;

    // @reference reference/freeciv/data/classic/effects.ruleset:1175-1199,1764-1781,953-980
    expect(effects.library_science_bonus).toMatchObject({ type: 'Output_Bonus', value: 100 });
    expect(effects.marketplace_gold_bonus).toMatchObject({ type: 'Output_Bonus', value: 50 });
    // @reference reference/freeciv/data/classic/effects.ruleset:1193-1201
    expect(effects.marketplace_luxury_bonus).toMatchObject({ type: 'Output_Bonus', value: 50 });
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
    // @reference reference/freeciv/data/classic/effects.ruleset:157-173
    expect(effects.fortified_defense).toMatchObject({
      type: 'Fortify_Defense_Bonus',
      value: 50,
    });
    expect(effects.city_fortified_defense).toMatchObject({
      type: 'Fortify_Defense_Bonus',
      value: 50,
    });
    // @reference reference/freeciv/data/classic/effects.ruleset:1020-1028
    expect(effects.courthouse_trade_waste).toMatchObject({ type: 'Output_Waste_Pct', value: 50 });
    // @reference reference/freeciv/data/classic/effects.ruleset:1038-1045
    expect(effects.courthouse_democracy_content).toMatchObject({ type: 'Make_Content', value: 1 });
    // @reference reference/freeciv/data/classic/effects.ruleset:1097-1110
    expect(effects.granary_growth_food).toMatchObject({ type: 'Growth_Food', value: 50 });
    expect(effects.granary_shrink_food).toMatchObject({ type: 'Shrink_Food', value: 50 });
    // @reference reference/freeciv/data/classic/effects.ruleset:904-925
    expect(effects.barracks_veteran_build).toMatchObject({ type: 'Veteran_Build', value: 1 });
    // @reference reference/freeciv/data/classic/effects.ruleset:1314-1379
    expect(effects.palace_corruption_immunity).toMatchObject({
      type: 'Output_Waste_Pct',
      value: 50,
    });
    expect(effects.palace_despotism_shield_bonus).toMatchObject({
      type: 'Output_Bonus',
      value: 75,
    });
    expect(effects.palace_monarchy_shield_bonus).toMatchObject({ type: 'Output_Bonus', value: 50 });
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
