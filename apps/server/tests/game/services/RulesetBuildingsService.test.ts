import { rulesetBuildingsService } from '@game/services/RulesetBuildingsService';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';

describe('RulesetBuildingsService', () => {
  afterEach(() => rulesetBuildingsService.clearCache());

  it('maps the full classic building catalogue into city production data', () => {
    const buildings = rulesetBuildingsService.getBuildingTypes();
    const classicBuildings = rulesetLoader.getBuildings();

    // @reference reference/freeciv/data/classic/buildings.ruleset
    expect(Object.keys(buildings)).toHaveLength(Object.keys(classicBuildings).length);
    expect(buildings.walls.cost).toBe(classicBuildings.walls.cost);
    expect(buildings.temple.effects.happinessEffect).toBe(
      classicBuildings.temple.effects.happinessBonus
    );
    expect(buildings.temple.requiredTech).toBe('ceremonial_burial');
    expect(buildings.cathedral).toMatchObject({
      requiredTech: 'monotheism',
      requires: ['temple'],
    });
  });
});
