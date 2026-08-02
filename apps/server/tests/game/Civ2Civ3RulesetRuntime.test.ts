import { UnitManager } from '@game/managers/UnitManager';
import { EffectsManager, EffectType } from '@game/managers/EffectsManager';
import { CityProductionService } from '@game/services/CityProductionService';
import { rulesetBuildingsService } from '@game/services/RulesetBuildingsService';
import { rulesetUnitsService } from '@game/services/RulesetUnitsService';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';

describe('Civ2Civ3 ruleset runtime routing', () => {
  it('discovers every complete installed ruleset while standalone catalogues retain classic compatibility', () => {
    expect(rulesetLoader.getAvailableRulesets()).toEqual(
      expect.arrayContaining(['classic', 'civ2civ3'])
    );
    expect(rulesetLoader.hasRuleset('classic')).toBe(true);
    expect(rulesetLoader.hasRuleset('civ2civ3')).toBe(true);
    expect(rulesetUnitsService.getUnitTypes()).toBe(rulesetUnitsService.getUnitTypes('classic'));
  });

  it.each(rulesetLoader.getAvailableRulesets())(
    'validates the discovered %s ruleset',
    rulesetName => {
      expect(() => rulesetLoader.validateRuleset(rulesetName)).not.toThrow();
    }
  );

  it.each(['classic', 'civ1', 'civ2civ3'])(
    'loads the requested %s catalogue independently',
    rulesetName => {
      const units = rulesetUnitsService.getUnitTypes(rulesetName);
      const buildings = rulesetBuildingsService.getPlayableBuildingTypes(rulesetName);

      expect(Object.keys(units).length).toBeGreaterThan(0);
      expect(Object.values(units).every(unit => unit.id && unit.name)).toBe(true);
      expect(Object.keys(buildings).length).toBeGreaterThan(0);
      expect(Object.values(buildings).every(building => building.id && building.name)).toBe(true);
    }
  );

  /**
   * @evidence parity
   * @reference reference/freeciv/data/default/nationlist.ruleset:2-46
   * @reference reference/freeciv/data/civ2civ3/nations.ruleset:64-69
   * @reference reference/freeciv/server/ruleset/ruleload.c:5187-5285
   * @reference reference/freeciv/common/nation.c:881-905
   * @assertion The default Core nation set and explicit all set retain the complete Civ2Civ3 reference roster and set membership.
   */
  it('resolves Freeciv Civ2Civ3 nation sets without losing the extended roster', () => {
    const core = rulesetLoader.getNationsForSet('civ2civ3');
    const all = rulesetLoader.getNationsForSet('civ2civ3', 'all');

    expect(rulesetLoader.resolveNationSet('civ2civ3')).toBe('core');
    expect(rulesetLoader.resolveNationSet('civ2civ3', 'all')).toBe('all');
    expect(() => rulesetLoader.resolveNationSet('civ2civ3', 'unknown')).toThrow(
      "Nation set 'unknown' is not defined by ruleset 'civ2civ3'"
    );

    expect(Object.keys(core)).toHaveLength(53);
    expect(Object.values(core).filter(nation => nation.is_playable !== false)).toHaveLength(50);
    expect(Object.keys(all)).toHaveLength(572);
    expect(Object.values(all).filter(nation => nation.is_playable !== false)).toHaveLength(569);
    expect(Object.values(core).every(nation => nation.sets?.includes('core'))).toBe(true);
    expect(Object.values(all).every(nation => nation.sets?.includes('all'))).toBe(true);
  });

  it('keeps Civ2Civ3-only migrants and its production catalogue on the game instance', () => {
    const unitTypes = rulesetUnitsService.getUnitTypes('civ2civ3');
    const unitManager = new UnitManager(
      'civ2civ3-game',
      {} as any,
      20,
      20,
      undefined,
      undefined,
      undefined,
      Math.random,
      unitTypes
    );

    expect(unitManager.getUnitType('migrants')).toMatchObject({
      requiredTech: 'pottery',
      pop_cost: 1,
      flags: expect.arrayContaining(['Workers', 'AddToCity', 'Capturable']),
    });
    expect(rulesetBuildingsService.getPlayableBuildingTypes('civ2civ3').city_walls.cost).toBe(30);

    const effectCoverage = new EffectsManager('civ2civ3').getEffectCoverage();
    expect(effectCoverage.total).toBe(505);
    expect(effectCoverage.unsupportedTypes).not.toContain('Airlift');
    expect(effectCoverage.unsupportedTypes).not.toContain('Incite_Cost_Pct');
    expect(
      new EffectsManager('civ2civ3').calculateEffect(EffectType.AIRLIFT, {
        cityBuildings: new Set(['airport']),
      }).value
    ).toBe(1);
    expect(
      new EffectsManager('civ2civ3').calculateEffect(EffectType.INCITE_COST_PCT, {
        maxUnitsOnTile: 1,
      }).value
    ).toBe(100);
    expect(
      new EffectsManager('civ2civ3').calculateEffect(EffectType.MOVE_BONUS, {
        unitClass: 'Sea',
        playerBuildings: new Set(['lighthouse']),
      }).value
    ).toBe(1);
  });

  it('applies Civ2Civ3 Great Wonder rush-production premium', () => {
    const effectsManager = new EffectsManager('civ2civ3', {
      getEffects: () => ({
        great_wonder_buy_cost: {
          id: 'great_wonder_buy_cost',
          type: 'Building_Buy_Cost_Pct',
          value: 100,
          reqs: [{ type: 'BuildingGenus', name: 'GreatWonder', range: 'Local' }],
        },
      }),
    });
    const cities = new Map([
      [
        'city',
        {
          id: 'city',
          playerId: 'player',
          currentProduction: 'wonder',
          productionType: 'building',
          productionStock: 10,
        },
      ],
    ]);
    const service = new CityProductionService(
      cities as any,
      { wonder: { id: 'wonder', genus: 'GreatWonder', cost: 100 } } as any,
      async () => 0,
      async () => false,
      {},
      effectsManager
    );

    expect(service.calculateBuyCost('city').goldCost).toBe(360);
  });
});
