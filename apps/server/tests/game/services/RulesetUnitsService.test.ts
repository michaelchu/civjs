import { RulesetUnitsService, rulesetUnitsService } from '@game/services/RulesetUnitsService';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';

describe('RulesetUnitsService', () => {
  afterEach(() => rulesetUnitsService.clearCache());

  /**
   * @evidence parity
   * @reference reference/freeciv/data/classic/units.ruleset:143-188
   * @assertion Representative unit types retain the exact class flags that drive native movement, combat, and lifecycle rules.
   */
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

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/units.ruleset:290-295
   * @reference reference/freeciv/data/civ2civ3/units.ruleset:1085-1106
   * @assertion The source embarks and disembarks declarations are normalized into the runtime unit catalogue without losing the designated transport class.
   */
  it('preserves Civ2Civ3 free helicopter embark and disembark classes', () => {
    expect(rulesetUnitsService.getUnitType('paratroopers', 'civ2civ3')).toEqual(
      expect.objectContaining({ embarks: ['Helicopter'], disembarks: ['Helicopter'] })
    );
  });

  it('keeps Settlers focused on founding cities rather than worker improvements', () => {
    expect(rulesetUnitsService.getUnitType('settlers')).toEqual(
      expect.objectContaining({
        canFoundCity: true,
        canBuildImprovements: false,
      })
    );
    expect(rulesetUnitsService.getUnitType('settlers', 'civ2civ3')).toEqual(
      expect.objectContaining({
        canFoundCity: true,
        canBuildImprovements: false,
      })
    );
    expect(rulesetUnitsService.getUnitType('worker', 'civ2civ3')).toEqual(
      expect.objectContaining({
        canFoundCity: false,
        canBuildImprovements: true,
      })
    );
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/units.ruleset:70-88
   * @reference reference/freeciv/data/civ2civ3/units.ruleset:612-646
   * @reference reference/freeciv/data/civ2civ3/units.ruleset:2349-2367
   * @reference reference/freeciv/data/civ2civ3/units.ruleset:2424-2438
   * @assertion Units without local veteran_* entries inherit c2c3's four-level profile, while local profiles preserve their own level count, combat factors, movement bonuses, and promotion chances.
   */
  it('maps c2c3 global and per-unit veteran profiles without a generic fallback', () => {
    const units = rulesetUnitsService.getUnitTypes('civ2civ3');

    expect(units.warriors?.veteranLevels).toEqual([
      expect.objectContaining({
        name: 'green',
        powerFactor: 1,
        moveBonus: 0,
        baseRaiseChance: 50,
        workRaiseChance: 3,
      }),
      expect.objectContaining({ name: 'veteran', powerFactor: 1.5, moveBonus: 0 }),
      expect.objectContaining({ name: 'hardened', powerFactor: 1.75, moveBonus: 0 }),
      expect.objectContaining({ name: 'elite', powerFactor: 2, moveBonus: 0 }),
    ]);
    expect(units.engineers?.veteranLevels?.map(level => level.name)).toEqual([
      'beginner',
      'seasoned',
      'senior',
      'expert',
    ]);
    expect(units.diplomat?.veteranLevels?.map(level => level.powerFactor)).toEqual([
      1, 1.05, 1.1, 1.15,
    ]);
    expect(units.nuclear?.veteranLevels).toEqual([
      expect.objectContaining({
        name: 'green',
        powerFactor: 1,
        moveBonus: 0,
        baseRaiseChance: 0,
      }),
    ]);
  });
});
