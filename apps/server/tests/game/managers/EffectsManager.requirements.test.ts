import { EffectType, EffectsManager, type EffectContext } from '@game/managers/EffectsManager';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';

jest.mock('@shared/data/rulesets/RulesetLoader', () => ({
  rulesetLoader: { getEffects: jest.fn() },
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

  it('fails closed for unsupported requirements', () => {
    const effects = new EffectsManager();
    mockedRulesetLoader.getEffects.mockReturnValueOnce({
      unsupported: {
        id: 'unsupported',
        type: 'Gov_Center',
        value: 99,
        reqs: [{ type: 'Action', name: 'Conquer City', range: 'Local' }],
      },
    });

    expect(effects.calculateEffect(EffectType.GOV_CENTER, {}).value).toBe(0);
  });

  it('does not activate a negative requirement when its context is absent', () => {
    const effects = new EffectsManager();

    expect(effects.calculateEffect(EffectType.FORTIFY_DEFENSE_BONUS, {}).value).toBe(0);
  });
});
