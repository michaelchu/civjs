import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';

describe('Freeciv Civ2Civ3 content catalogue', () => {
  afterEach(() => rulesetLoader.clearCache());

  it('contains the complete converted entity inventories', () => {
    // @reference reference/freeciv/data/civ2civ3/*.ruleset
    expect(Object.keys(rulesetLoader.getTerrains())).toHaveLength(14);
    expect(Object.keys(rulesetLoader.getUnits())).toHaveLength(57);
    expect(Object.keys(rulesetLoader.getBuildings())).toHaveLength(73);
    expect(Object.keys(rulesetLoader.getTechs())).toHaveLength(87);
    expect(Object.keys(rulesetLoader.getGovernments())).toHaveLength(9);
    expect(Object.keys(rulesetLoader.getNations())).toHaveLength(572);

    const cities = rulesetLoader.loadCitiesRuleset();
    expect(Object.keys(cities.specialists)).toEqual(['elvis', 'scientist', 'taxman']);

    const extras = rulesetLoader.loadExtrasRuleset();
    expect(Object.keys(extras.extras)).toHaveLength(38);
    expect(Object.keys(extras.resources)).toHaveLength(20);
    expect(Object.keys(extras.bases)).toHaveLength(5);
    expect(Object.keys(extras.roads)).toHaveLength(4);

    const styles = rulesetLoader.loadStylesRuleset();
    expect(Object.keys(styles.nation_styles)).toHaveLength(6);
    expect(Object.keys(styles.city_styles)).toHaveLength(10);
    expect(Object.keys(styles.music_styles)).toHaveLength(11);
    expect(rulesetLoader.getActionEnablers()).toHaveLength(89);
  });

  it('preserves representative source values and canonical identities', () => {
    // @reference reference/freeciv/data/civ2civ3/terrain.ruleset
    expect(Object.keys(rulesetLoader.getTerrains()).sort()).toEqual(
      [
        'deep_ocean',
        'desert',
        'forest',
        'glacier',
        'grassland',
        'hills',
        'inaccessible',
        'jungle',
        'lake',
        'mountains',
        'ocean',
        'plains',
        'swamp',
        'tundra',
      ].sort()
    );
    expect(rulesetLoader.getTerrain('glacier')).toMatchObject({
      moveCost: 2,
      miningShieldIncr: 1,
      transformTo: 'lake',
    });
    expect(rulesetLoader.getTerrain('inaccessible')).toMatchObject({
      moveCost: 0,
      notGenerated: true,
    });
    expect(rulesetLoader.getTerrain('coast')).toBe(rulesetLoader.getTerrain('ocean'));

    // @reference reference/freeciv/data/civ2civ3/units.ruleset
    expect(rulesetLoader.getUnits().fighter).toMatchObject({
      attack: 4,
      defense: 4,
      firepower: 1,
      vision_radius_sq: 8,
      flags: ['AirAttacker', 'HasNoZOC'],
    });

    // @reference reference/freeciv/data/civ2civ3/buildings.ruleset
    expect(rulesetLoader.getBuildings().city_walls).toMatchObject({
      name: 'City Walls',
      genus: 'Improvement',
      cost: 30,
    });
    expect(rulesetLoader.getBuildings().capitalization).toMatchObject({
      name: 'Coinage',
      genus: 'Convert',
      cost: 999,
    });

    // @reference reference/freeciv/data/civ2civ3/nations.ruleset
    expect(rulesetLoader.getNations().roman.leaders).toHaveLength(23);
    expect(Object.keys(rulesetLoader.loadNationsRuleset().nation_sets)).toHaveLength(2);
    expect(Object.keys(rulesetLoader.loadNationsRuleset().nation_groups)).toHaveLength(11);
  });
});
