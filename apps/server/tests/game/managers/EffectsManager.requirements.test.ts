import {
  EffectType,
  EffectsManager,
  OutputType,
  type EffectContext,
} from '@game/managers/EffectsManager';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';

jest.mock('@shared/data/rulesets/RulesetLoader', () => ({
  rulesetLoader: { getEffects: jest.fn(), getBuildings: jest.fn() },
}));

const mockedRulesetLoader = jest.mocked(rulesetLoader);

describe('EffectsManager classic requirement evaluation', () => {
  beforeEach(() => {
    mockedRulesetLoader.getEffects.mockReturnValue({
      mountain_vision: {
        id: 'mountain_vision',
        type: 'Unit_Vision_Radius_Sq',
        value: 4,
        // @reference reference/freeciv/data/classic/effects.ruleset:132-140
        reqs: [
          { type: 'Terrain', name: 'Mountains', range: 'Tile' },
          { type: 'UnitClass', name: 'Land', range: 'Local' },
        ],
      },
      city_defense: {
        id: 'city_defense',
        type: 'Fortify_Defense_Bonus',
        value: 50,
        // @reference reference/freeciv/data/classic/effects.ruleset:164-172
        reqs: [
          { type: 'CityTile', name: 'Center', range: 'Tile' },
          { type: 'Activity', name: 'Fortified', range: 'Local', present: false },
          { type: 'UnitClassFlag', name: 'CanFortify', range: 'Local' },
          { type: 'UnitTypeFlag', name: 'Cant_Fortify', range: 'Local', present: false },
        ],
      },
      palace_center: {
        id: 'palace_center',
        type: 'Gov_Center',
        value: 1,
        // @reference reference/freeciv/data/classic/effects.ruleset:620-626
        reqs: [{ type: 'Building', name: 'Palace', range: 'City' }],
      },
      wonder_blocked: {
        id: 'wonder_blocked',
        type: 'Gov_Center',
        value: 5,
        reqs: [{ type: 'Building', name: 'great_wall', range: 'Player', present: false }],
      },
      base_upkeep_not_gold: {
        id: 'base_upkeep_not_gold',
        type: 'Upkeep_Pct',
        value: 100,
        // @reference reference/freeciv/data/classic/effects.ruleset:343-349
        reqs: [{ type: 'OutputType', name: 'Gold', range: 'Local', present: false }],
      },
      base_upkeep_gold: {
        id: 'base_upkeep_gold',
        type: 'Upkeep_Pct',
        value: 100,
        // @reference reference/freeciv/data/classic/effects.ruleset:351-358
        reqs: [
          { type: 'OutputType', name: 'Gold', range: 'Local' },
          { type: 'UnitState', name: 'HasHomeCity', range: 'Local' },
        ],
      },
      republic_unhappy: {
        id: 'republic_unhappy',
        type: 'Unhappy_Factor',
        value: 1,
        // @reference reference/freeciv/data/classic/effects.ruleset:378-384
        reqs: [{ type: 'Gov', name: 'Republic', range: 'Player' }],
      },
      republic_corruption: {
        id: 'republic_corruption',
        type: 'Output_Waste',
        value: 15,
        // @reference reference/freeciv/data/classic/effects.ruleset:325-332
        reqs: [
          { type: 'Gov', name: 'Republic', range: 'Player' },
          { type: 'OutputType', name: 'Trade', range: 'Local' },
        ],
      },
    });
  });

  it('applies terrain and unit-class effects only in their matching context', () => {
    const effects = new EffectsManager();
    const matching: EffectContext = { tileTerrain: 'mountains', unitClass: 'Land' };

    expect(effects.calculateEffect(EffectType.UNIT_VISION_RADIUS_SQ, matching).value).toBe(4);
    expect(
      effects.calculateEffect(EffectType.UNIT_VISION_RADIUS_SQ, {
        ...matching,
        tileTerrain: 'grassland',
      }).value
    ).toBe(0);
  });

  it('caches the declared effect-type lookup and invalidates it with the ruleset cache', () => {
    const effects = new EffectsManager();

    expect(effects.hasEffectType(EffectType.UNIT_VISION_RADIUS_SQ)).toBe(true);
    expect(effects.hasEffectType(EffectType.IRRIGATION_PCT)).toBe(false);
    expect(mockedRulesetLoader.getEffects).toHaveBeenCalledTimes(1);

    effects.clearCache();

    expect(effects.hasEffectType(EffectType.UNIT_VISION_RADIUS_SQ)).toBe(true);
    expect(mockedRulesetLoader.getEffects).toHaveBeenCalledTimes(2);
  });

  it('honours positive and negative city-tile, activity, and flag requirements', () => {
    const effects = new EffectsManager();
    const matching: EffectContext = {
      tileIsCityCenter: true,
      unitActivity: 'Sentry',
      unitClassFlags: new Set(['CanFortify']),
      unitTypeFlags: new Set(),
    };

    expect(effects.calculateEffect(EffectType.FORTIFY_DEFENSE_BONUS, matching).value).toBe(50);
    expect(
      effects.calculateEffect(EffectType.FORTIFY_DEFENSE_BONUS, {
        ...matching,
        unitActivity: 'Fortified',
      }).value
    ).toBe(0);
  });

  it('matches classic display names against normalized ruleset identifiers', () => {
    const effects = new EffectsManager();

    expect(
      effects.calculateEffect(EffectType.GOV_CENTER, { cityBuildings: new Set(['palace']) }).value
    ).toBe(1);
  });

  it('evaluates player-range buildings separately from the city buildings', () => {
    const effects = new EffectsManager();

    expect(
      effects.calculateEffect(EffectType.GOV_CENTER, {
        cityBuildings: new Set(['palace']),
        playerBuildings: new Set(),
      }).value
    ).toBe(6);
    expect(
      effects.calculateEffect(EffectType.GOV_CENTER, {
        cityBuildings: new Set(['palace']),
        playerBuildings: new Set(['great_wall']),
      }).value
    ).toBe(1);
  });

  it('evaluates building flags from the ruleset, including string-form flags', () => {
    mockedRulesetLoader.getBuildings.mockReturnValue({
      barracks: {
        id: 'barracks',
        name: 'Barracks',
        genus: 'Improvement',
        cost: 30,
        upkeep: 1,
        playable: true,
        flags: 'Barracks',
        effects: {},
      },
    } as never);
    const effects = new EffectsManager();

    expect(
      effects.evaluateRequirements([{ type: 'BuildingFlag', name: 'Barracks', range: 'City' }], {
        cityBuildings: new Set(['barracks']),
      }).satisfied
    ).toBe(true);
    expect(
      effects.evaluateRequirements([{ type: 'BuildingFlag', name: 'Barracks', range: 'City' }], {
        cityBuildings: new Set(['granary']),
      }).satisfied
    ).toBe(false);
  });

  it('accepts the lowercase technology requirement spelling used by governments', () => {
    const effects = new EffectsManager();
    expect(
      effects.evaluateRequirements([{ type: 'tech', name: 'Monarchy', range: 'Player' }], {
        playerTechs: new Set(['monarchy']),
      }).satisfied
    ).toBe(true);
  });

  it('evaluates world technology requirements against the shared world set', () => {
    const effects = new EffectsManager();

    expect(
      effects.evaluateRequirements([{ type: 'Tech', name: 'Guerilla Warfare', range: 'World' }], {
        playerTechs: new Set(),
        worldTechs: new Set(['guerilla_warfare']),
      }).satisfied
    ).toBe(true);
  });

  it('fails closed for unsupported requirements', () => {
    const effects = new EffectsManager();
    mockedRulesetLoader.getEffects.mockReturnValueOnce({
      unsupported: {
        id: 'unsupported',
        type: 'Gov_Center',
        value: 99,
        reqs: [{ type: 'Action', name: 'Conquer City', range: 'Local' }] as never,
      },
    });

    expect(effects.calculateEffect(EffectType.GOV_CENTER, {}).value).toBe(0);
  });

  it('evaluates MinCulture against the supplied city and player context', () => {
    const effects = new EffectsManager();

    expect(
      effects.evaluateRequirements([{ type: 'MinCulture', name: '100', range: 'City' }], {
        cityCulture: 99,
      }).satisfied
    ).toBe(false);
    expect(
      effects.evaluateRequirements([{ type: 'MinCulture', name: '100', range: 'City' }], {
        cityCulture: 100,
      }).satisfied
    ).toBe(true);
    expect(
      effects.evaluateRequirements([{ type: 'MinCulture', name: '1000', range: 'Player' }], {
        playerCulture: 1000,
      }).satisfied
    ).toBe(true);
    expect(
      effects.evaluateRequirements([{ type: 'MinCulture', name: '1000', range: 'Player' }], {
        playerCulture: 999,
      }).satisfied
    ).toBe(false);
  });

  it('uses the matching player set for shared and trade-route culture ranges', () => {
    const effects = new EffectsManager();

    expect(
      effects.evaluateRequirements([{ type: 'MinCulture', name: '1000', range: 'World' }], {
        playerCulture: 100,
        playerCulturesInRange: [100, 1000],
      }).satisfied
    ).toBe(true);
    expect(
      effects.evaluateRequirements([{ type: 'MinCulture', name: '1000', range: 'World' }], {
        playerCulture: 1000,
        playerCulturesInRange: [100],
      }).satisfied
    ).toBe(false);
    expect(
      effects.evaluateRequirements([{ type: 'MinCulture', name: '500', range: 'TradeRoute' }], {
        cityCulture: 100,
        tradeRouteCultures: [500],
      }).satisfied
    ).toBe(true);
  });

  it('evaluates terrain flags and known AI-level requirements', () => {
    mockedRulesetLoader.getEffects.mockReturnValueOnce({
      sea_bonus: {
        id: 'sea_bonus',
        type: 'Output_Add_Tile',
        value: 1,
        reqs: [{ type: 'TerrainFlag', name: 'Sea', range: 'Tile' }],
      },
      ai_bonus: {
        id: 'ai_bonus',
        type: 'Output_Bonus',
        value: 10,
        reqs: [{ type: 'AI', name: 'Cheating', range: 'Player' }],
      },
    });
    const effects = new EffectsManager();

    expect(
      effects.calculateEffect(EffectType.OUTPUT_ADD_TILE, {
        tileTerrainFlags: new Set(['Sea']),
      }).value
    ).toBe(1);
    expect(
      effects.calculateEffect(EffectType.OUTPUT_BONUS, {
        playerIsAI: true,
        aiLevel: 'Cheating',
      }).value
    ).toBe(10);
    expect(effects.calculateEffect(EffectType.OUTPUT_BONUS, {}).value).toBe(0);
  });

  it('evaluates terrain-alteration requirements from the supplied tile context', () => {
    const effects = new EffectsManager();
    const requirement = [{ type: 'TerrainAlter', name: 'CanIrrigate', range: 'Tile' }];

    expect(
      effects.evaluateRequirements(requirement, {
        tileTerrainAlterations: new Set(['CanIrrigate', 'CanMine']),
      }).satisfied
    ).toBe(true);
    expect(
      effects.evaluateRequirements(requirement, {
        tileTerrainAlterations: new Set(['CanMine']),
      }).satisfied
    ).toBe(false);
    expect(effects.evaluateRequirements(requirement, {}).satisfied).toBe(false);
  });

  it('does not activate a negative requirement when its context is absent', () => {
    const effects = new EffectsManager();

    expect(effects.calculateEffect(EffectType.FORTIFY_DEFENSE_BONUS, {}).value).toBe(0);
  });

  it('applies gold upkeep only to units with a home city', () => {
    const effects = new EffectsManager();

    expect(
      effects.calculateEffect(EffectType.UPKEEP_PCT, {
        outputType: OutputType.GOLD,
        unitHasHomeCity: true,
      }).value
    ).toBe(100);
    expect(
      effects.calculateEffect(EffectType.UPKEEP_PCT, {
        outputType: OutputType.GOLD,
        unitHasHomeCity: false,
      }).value
    ).toBe(0);
  });

  it('fails closed when required government, output, or unit-state context is absent', () => {
    const effects = new EffectsManager();

    expect(effects.calculateEffect(EffectType.UPKEEP_PCT, {}).value).toBe(0);
    expect(
      effects.calculateEffect(EffectType.UPKEEP_PCT, { outputType: OutputType.GOLD }).value
    ).toBe(0);
    expect(effects.calculateEffect(EffectType.UNHAPPY_FACTOR, {}).value).toBe(0);
  });

  it('does not apply classic corruption to non-trade output or missing government context', () => {
    const effects = new EffectsManager();

    expect(
      effects.calculateEffect(EffectType.OUTPUT_WASTE, {
        government: 'Republic',
        outputType: OutputType.TRADE,
      }).value
    ).toBe(15);
    expect(
      effects.calculateEffect(EffectType.OUTPUT_WASTE, {
        government: 'Republic',
        outputType: OutputType.SHIELD,
      }).value
    ).toBe(0);
    expect(
      effects.calculateEffect(EffectType.OUTPUT_WASTE, { outputType: OutputType.TRADE }).value
    ).toBe(0);
  });

  it('fails closed for unsupported unit-state names even when negated', () => {
    const effects = new EffectsManager();

    expect(
      effects.evaluateRequirements(
        [{ type: 'UnitState', name: 'UnsupportedState', range: 'Local', present: false }],
        { unitHasHomeCity: false }
      ).satisfied
    ).toBe(false);
  });
});
