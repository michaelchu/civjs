import { join } from 'path';
import { EffectsManager, EffectType } from '@game/managers/EffectsManager';
import { RulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import { EffectsRulesetFileSchema } from '@shared/data/rulesets/schemas';

describe('RulesetLoader C2C3 effects ruleset', () => {
  const createLoader = () => new RulesetLoader(join(process.cwd(), 'src/shared/data/rulesets'));

  it('loads every required C2C3 ruleset data file', () => {
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

  it('loads C2C3 government corruption and distance effects', () => {
    const effects = createLoader().loadEffectsRuleset().effects;

    // @reference reference/freeciv/data/civ2civ3/effects.ruleset:258-350
    expect(effects.corruption_tribal).toMatchObject({
      type: 'Output_Waste',
      value: 30,
      reqs: expect.arrayContaining([
        { type: 'Gov', name: 'Tribal', range: 'Player' },
        { type: 'OutputType', name: 'Trade', range: 'Local' },
      ]),
    });
    expect(effects.corruption_distance).toMatchObject({
      type: 'Output_Waste_By_Distance',
      value: 100,
      reqs: expect.arrayContaining([{ type: 'OutputType', name: 'Trade', range: 'Local' }]),
    });
  });

  it('evaluates C2C3 city history, growth, and City Walls effects', () => {
    const effectsManager = new EffectsManager('civ2civ3');

    expect(
      effectsManager.calculateEffect(EffectType.HISTORY, {
        playerId: 'player-1',
        cityId: 'city-1',
        cityBuildings: new Set(['library']),
      }).value
    ).toBe(1);
    expect(
      effectsManager.calculateEffect(EffectType.GROWTH_FOOD, {
        playerId: 'player-1',
        cityId: 'city-1',
        cityPopulation: 1,
        cityBuildings: new Set(),
      }).value
    ).toBe(50);
    expect(
      effectsManager.calculateEffect(EffectType.DEFEND_BONUS, {
        playerId: 'player-1',
        cityId: 'city-1',
        cityBuildings: new Set(['city_walls']),
        unitClassFlags: new Set(['Ground']),
      }).value
    ).toBe(100);
  });

  it('loads C2C3 Democracy senate and unhappiness effects', () => {
    const effects = createLoader().loadEffectsRuleset().effects;

    // @reference reference/freeciv/data/civ2civ3/effects.ruleset:752-789
    expect(effects.senate_democracy).toMatchObject({
      type: 'Has_Senate',
      value: 1,
      reqs: expect.arrayContaining([
        expect.objectContaining({ type: 'Gov', name: 'Democracy', range: 'Player' }),
      ]),
    });
    expect(effects.unit_unhappiness_democracy).toMatchObject({
      type: 'Unhappy_Factor',
      value: 2,
      reqs: expect.arrayContaining([
        expect.objectContaining({ type: 'Gov', name: 'Democracy', range: 'Player' }),
      ]),
    });
  });

  it('restricts C2C3 corruption effects to trade output', () => {
    const effects = createLoader().loadEffectsRuleset().effects;
    const corruptionEffectIds = [
      'corruption_tribal',
      'corruption_despotism',
      'corruption_monarchy',
      'corruption_communism',
      'corruption_fundamentalism',
      'corruption_republic',
      'corruption_democracy',
      'corruption_distance',
    ];

    for (const effectId of corruptionEffectIds) {
      expect(effects[effectId]!.reqs).toContainEqual({
        type: 'OutputType',
        name: 'Trade',
        range: 'Local',
      });
    }
  });

  it('rejects effects with requirement types that the runtime cannot evaluate', () => {
    const effects = createLoader().loadEffectsRuleset();
    const invalidEffects = structuredClone(effects);
    invalidEffects.effects.corruption_tribal.reqs = [
      { type: 'UnsupportedRequirement', name: 'anything', range: 'Local' },
    ] as never;

    expect(EffectsRulesetFileSchema.safeParse(invalidEffects).success).toBe(false);
  });
});
