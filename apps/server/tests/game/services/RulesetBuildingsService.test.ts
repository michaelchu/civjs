import { rulesetBuildingsService } from '@game/services/RulesetBuildingsService';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';

describe('RulesetBuildingsService', () => {
  afterEach(() => rulesetBuildingsService.clearCache());

  it('maps the full classic building catalogue into city production data', () => {
    const buildings = rulesetBuildingsService.getBuildingTypes();
    const classicBuildings = rulesetLoader.getBuildings();

    // @reference reference/freeciv/data/classic/buildings.ruleset
    expect(Object.keys(buildings)).toHaveLength(Object.keys(classicBuildings).length);
    expect(buildings.city_walls.cost).toBe(classicBuildings.city_walls.cost);
    expect(buildings.temple.effects.happinessEffect).toBe(
      classicBuildings.temple.effects.happinessBonus
    );
    expect(buildings.temple.requiredTech).toBe('ceremonial_burial');
    expect(buildings.cathedral).toMatchObject({
      requiredTech: 'monotheism',
      requires: ['temple'],
    });

    // Representative exact build costs from the classic source.
    // @reference reference/freeciv/data/classic/buildings.ruleset
    expect(buildings.palace.cost).toBe(70);
    expect(buildings.granary.cost).toBe(40);
    expect(buildings.barracks.cost).toBe(30);
    expect(buildings.library.cost).toBe(60);
    expect(buildings.marketplace.cost).toBe(60);
    expect(buildings.temple.cost).toBe(30);
    expect(buildings.city_walls.cost).toBe(60);
    expect(buildings.cathedral.cost).toBe(80);
    expect(buildings.courthouse.cost).toBe(60);

    expect(Object.keys(rulesetBuildingsService.getPlayableBuildingTypes())).toEqual(
      expect.arrayContaining(['palace', 'granary', 'barracks', 'library', 'marketplace', 'temple'])
    );

    // Every classic definition is present, with no CivJS-only catalogue entries.
    // @reference reference/freeciv/data/classic/buildings.ruleset
    expect(Object.keys(buildings)).toHaveLength(68);
    expect(buildings).not.toHaveProperty('monument');
    expect(buildings.airport).toMatchObject({ requiredTech: 'radio' });
    expect(buildings.bank.requires).toEqual(['marketplace']);
    expect(buildings.aqueduct.effects.maxCitySize).toBe(12);
    expect(buildings.sewer_system.effects.unlimitedCitySize).toBe(true);
    expect(buildings.harbor.effects.oceanFood).toBe(1);
    expect(buildings.offshore_platform.effects.oceanShields).toBe(1);
    expect(buildings.darwins_voyage.effects.immediateTechs).toBe(2);
    expect(buildings.great_library.effects.techParasitePlayers).toBe(2);
    expect(buildings.courthouse.effects.corruptionReduction).toBe(50);
  });
});
