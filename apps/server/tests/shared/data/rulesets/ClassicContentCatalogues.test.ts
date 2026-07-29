import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';

describe('Freeciv classic content catalogues', () => {
  afterEach(() => rulesetLoader.clearCache());

  it('contains the complete reference entity inventories without legacy extensions', () => {
    // @reference reference/freeciv/data/classic/*.ruleset
    expect(Object.keys(rulesetLoader.getTerrains())).toHaveLength(14);
    expect(Object.keys(rulesetLoader.getUnits())).toHaveLength(52);
    expect(Object.keys(rulesetLoader.getBuildings())).toHaveLength(68);
    expect(Object.keys(rulesetLoader.getTechs())).toHaveLength(87);
    expect(Object.keys(rulesetLoader.getGovernments())).toHaveLength(6);
    expect(Object.keys(rulesetLoader.getNations())).toHaveLength(25);

    const cities = rulesetLoader.loadCitiesRuleset();
    expect(Object.keys(cities.specialists)).toEqual(['elvis', 'scientist', 'taxman']);

    const extras = rulesetLoader.loadExtrasRuleset();
    expect(Object.keys(extras.extras)).toHaveLength(34);
    expect(Object.keys(extras.resources)).toHaveLength(20);
    expect(Object.keys(extras.bases)).toHaveLength(3);
    expect(Object.keys(extras.roads)).toHaveLength(3);

    const styles = rulesetLoader.loadStylesRuleset();
    expect(Object.keys(styles.nation_styles)).toHaveLength(6);
    expect(Object.keys(styles.city_styles)).toHaveLength(10);
    expect(Object.keys(styles.music_styles)).toHaveLength(11);
    expect(rulesetLoader.getActionEnablers()).toHaveLength(82);

    expect(rulesetLoader.getUnits()).not.toHaveProperty('fanatic');
    expect(rulesetLoader.getUnits()).not.toHaveProperty('elephants');
    expect(rulesetLoader.getUnits()).not.toHaveProperty('crusaders');
    expect(rulesetLoader.getBuildings()).not.toHaveProperty('monument');
    expect(rulesetLoader.getBuildings()).not.toHaveProperty('walls');
  });

  it('preserves representative source values and canonical identities', () => {
    // @reference reference/freeciv/data/classic/terrain.ruleset
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
      transformTo: 'tundra',
    });
    expect(rulesetLoader.getTerrain('inaccessible')).toMatchObject({
      moveCost: 0,
      notGenerated: true,
    });
    expect(rulesetLoader.getTerrain('coast')).toBe(rulesetLoader.getTerrain('ocean'));

    // @reference reference/freeciv/data/classic/units.ruleset
    expect(rulesetLoader.getUnits().fighter).toMatchObject({
      attack: 4,
      defense: 3,
      firepower: 2,
      vision_radius_sq: 8,
      flags: ['AirAttacker'],
    });

    // @reference reference/freeciv/data/classic/buildings.ruleset
    expect(rulesetLoader.getBuildings().city_walls).toMatchObject({
      name: 'City Walls',
      genus: 'Improvement',
      cost: 60,
    });
    expect(rulesetLoader.getBuildings().capitalization).toMatchObject({
      name: 'Wealth',
      genus: 'Convert',
      cost: 999,
    });

    // Includes the default nation list plus the classic barbarian and pirate nations.
    // @reference reference/freeciv/data/classic/nations.ruleset
    expect(rulesetLoader.getNations().roman.leaders).toHaveLength(23);
    expect(Object.keys(rulesetLoader.loadNationsRuleset().nation_sets)).toHaveLength(1);
    expect(Object.keys(rulesetLoader.loadNationsRuleset().nation_groups)).toHaveLength(11);
  });
});
