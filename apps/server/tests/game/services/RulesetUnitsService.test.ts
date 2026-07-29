import { RulesetUnitsService, rulesetUnitsService } from '@game/services/RulesetUnitsService';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';

describe('RulesetUnitsService', () => {
  afterEach(() => rulesetUnitsService.clearCache());

  it('maps every classic unit class flag catalogue entry onto its units', () => {
    // @reference reference/freeciv/data/classic/units.ruleset:143-188
    expect(rulesetUnitsService.getUnitType('cruise_missile')?.rulesetUnitClassFlags).toEqual([
      'Missile',
      'Unreachable',
      'DoesntOccupyTile',
      'HutFrighten',
    ]);
    expect(rulesetUnitsService.getUnitType('warriors')?.rulesetUnitClassFlags).toEqual([
      'TerrainSpeed',
      'DamageSlows',
      'CanOccupyCity',
      'BuildAnywhere',
      'CollectRansom',
      'ZOC',
      'CanFortify',
      'CanPillage',
      'TerrainDefense',
      'KillCitizen',
      'NonNatBombardTgt',
    ]);
    expect(rulesetUnitsService.getUnitType('caravel')?.rulesetUnitClassFlags).toEqual([
      'DamageSlows',
      'AttackNonNative',
      'AttFromNonNative',
    ]);
    expect(rulesetUnitsService.getUnitType('trireme')?.rulesetUnitClassFlags).toEqual([
      'DamageSlows',
      'AttFromNonNative',
    ]);
    expect(rulesetUnitsService.getUnitType('helicopter')?.rulesetUnitClassFlags).toEqual([
      'CanOccupyCity',
      'CollectRansom',
    ]);
    expect(rulesetUnitsService.getUnitType('fighter')?.rulesetUnitClassFlags).toEqual([
      'Unreachable',
      'DoesntOccupyTile',
      'HutFrighten',
    ]);
  });

  it('changes mapped class flags when the injected ruleset catalogue changes', () => {
    const unitsRuleset = structuredClone(rulesetLoader.loadUnitsRuleset());
    unitsRuleset.unit_classes.Land.flags = ['InjectedFlag'];
    const service = new RulesetUnitsService({ loadUnitsRuleset: () => unitsRuleset });

    expect(service.getUnitType('warriors')?.rulesetUnitClassFlags).toEqual(['InjectedFlag']);
  });

  it('rejects an injected ruleset whose unit class is missing from the catalogue', () => {
    const unitsRuleset = structuredClone(rulesetLoader.loadUnitsRuleset());
    delete unitsRuleset.unit_classes.Land;
    const service = new RulesetUnitsService({ loadUnitsRuleset: () => unitsRuleset });

    expect(() => service.getUnitType('warriors')).toThrow(
      "Unit 'settlers' references missing unit class 'Land'"
    );
  });

  it('classifies movement from each loaded unit class and rejects unknown IDs', () => {
    expect(rulesetUnitsService.getMovementType('warriors')).toBe('land');
    expect(rulesetUnitsService.getMovementType('trireme')).toBe('sea');
    expect(rulesetUnitsService.getMovementType('caravel')).toBe('sea');
    expect(rulesetUnitsService.getMovementType('fighter')).toBe('air');
    expect(rulesetUnitsService.getMovementType('helicopter')).toBe('air');
    expect(rulesetUnitsService.getMovementType('cruise_missile')).toBe('air');
    expect(rulesetUnitsService.getMovementType('unknown_unit')).toBeUndefined();
  });

  it('preserves classic target classes and combat bonuses', () => {
    const fighter = rulesetUnitsService.getUnitType('fighter')!;
    const aegis = rulesetUnitsService.getUnitType('aegis_cruiser')!;

    expect(fighter.targetClasses).toEqual(['Air', 'Missile']);
    expect(fighter.combatBonuses).toContainEqual({
      flag: 'Bomber',
      type: 'DefenseMultiplier',
      value: 1,
    });
    expect(aegis.combatBonuses).toEqual([
      { flag: 'AirAttacker', type: 'DefenseMultiplier', value: 4 },
    ]);
  });

  it('keeps Workers buildable without a technology prerequisite', () => {
    expect(rulesetUnitsService.getUnitType('worker')).toEqual(
      expect.objectContaining({
        id: 'worker',
        cost: 10,
        requiredTech: undefined,
      })
    );
  });

  it('keeps Settlers focused on founding cities rather than worker improvements', () => {
    expect(rulesetUnitsService.getUnitType('settlers')).toEqual(
      expect.objectContaining({
        canFoundCity: true,
        canBuildImprovements: false,
      })
    );
  });
});
