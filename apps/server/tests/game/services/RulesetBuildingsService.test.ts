import { rulesetBuildingsService } from '@game/services/RulesetBuildingsService';
import { EffectsManager, EffectType, OutputType } from '@game/managers/EffectsManager';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';

describe('RulesetBuildingsService', () => {
  afterEach(() => rulesetBuildingsService.clearCache());

  it('maps the full Civ2Civ3 building catalogue into city production data', () => {
    const buildings = rulesetBuildingsService.getBuildingTypes();
    const civ2civ3Buildings = rulesetLoader.getBuildings();

    // @reference reference/freeciv/data/civ2civ3/buildings.ruleset
    expect(Object.keys(buildings)).toHaveLength(Object.keys(civ2civ3Buildings).length);
    expect(buildings.city_walls.cost).toBe(civ2civ3Buildings.city_walls.cost);
    expect(buildings.temple.effects.happinessEffect).toBe(
      civ2civ3Buildings.temple.effects.happinessBonus
    );
    expect(buildings.temple.requiredTech).toBe('ceremonial_burial');
    expect(buildings.cathedral).toMatchObject({
      requiredTech: 'monotheism',
      requires: ['temple'],
    });

    // Representative exact build costs from the Civ2Civ3 source.
    // @reference reference/freeciv/data/civ2civ3/buildings.ruleset
    expect(buildings.palace.cost).toBe(70);
    expect(buildings.granary.cost).toBe(40);
    expect(buildings.barracks.cost).toBe(30);
    expect(buildings.library.cost).toBe(60);
    expect(buildings.marketplace.cost).toBe(60);
    expect(buildings.temple.cost).toBe(30);
    expect(buildings.city_walls.cost).toBe(30);
    expect(buildings.cathedral.cost).toBe(80);
    expect(buildings.courthouse.cost).toBe(60);

    expect(Object.keys(rulesetBuildingsService.getPlayableBuildingTypes())).toEqual(
      expect.arrayContaining(['palace', 'granary', 'barracks', 'library', 'marketplace', 'temple'])
    );

    // Every Civ2Civ3 definition is present, with no CivJS-only catalogue entries.
    // @reference reference/freeciv/data/civ2civ3/buildings.ruleset
    expect(Object.keys(buildings)).toHaveLength(73);
    expect(buildings).not.toHaveProperty('monument');
    expect(buildings.airport).toMatchObject({ requiredTech: 'radio' });
    expect(buildings.bank.requires).toEqual(['marketplace']);
    expect(buildings.aqueduct.effects).toEqual({});
    expect(buildings.sewer_system.effects).toEqual({});
    expect(buildings.harbor.effects).toEqual({});
    expect(buildings.offshore_platform.effects).toEqual({});
    expect(buildings.darwins_voyage.effects).toEqual({});
    expect(buildings.great_library.effects).toEqual({});
    expect(buildings.courthouse.effects).toEqual({});
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/buildings.ruleset:631-639
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:2168-2175
   * @assertion c2c3 building catalogues retain construction data only; Library's science behavior is evaluated from the authoritative Output_Bonus effect rather than a legacy building summary.
   * @c2c3-surface city-economy
   * @c2c3-surface-scenario normal
   */
  it('uses raw c2c3 effects instead of a static building-effect adapter', () => {
    const buildings = rulesetBuildingsService.getBuildingTypes('civ2civ3');

    expect(buildings.library.effects).toEqual({});
    expect(
      new EffectsManager('civ2civ3').calculateEffect(EffectType.OUTPUT_BONUS, {
        cityBuildings: new Set(['library']),
        outputType: OutputType.SCIENCE,
      }).value
    ).toBe(50);
  });
});
