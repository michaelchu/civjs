/**
 * Service for accessing unit types from rulesets instead of hardcoded constants
 * Provides the same interface as the old UNIT_TYPES constant but loads dynamically from rulesets
 */

import { rulesetLoader, type RulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import type { UnitClass, UnitTypeRuleset } from '@shared/data/rulesets/schemas';

export type UnitMovementType = 'land' | 'sea' | 'air';

export interface UnitCombatBonus {
  flag: string;
  type: string;
  value: number;
}

export interface UnitType {
  id: string;
  name: string;
  cost: number;
  movement: number;
  combat: number; // For backward compatibility - maps to attack value
  attack?: number; // Freeciv attack value
  defense?: number; // Freeciv defense value
  range: number;
  sight: number; // For backward compatibility - maps to vision_radius_sq
  vision_radius_sq?: number; // Freeciv vision value
  visionLayer: 'Main' | 'Stealth' | 'Subsurface';
  canFoundCity: boolean;
  canBuildImprovements: boolean;
  unitClass: 'military' | 'civilian' | 'naval' | 'air';
  rulesetUnitClass?: string;
  /** @reference reference/freeciv/data/classic/units.ruleset:143-188 */
  rulesetUnitClassFlags: string[];
  requiredTech?: string;
  transport_capacity?: number;
  cargoClasses: string[];
  targetClasses?: string[];
  combatBonuses?: UnitCombatBonus[];
  // Additional freeciv fields
  hitpoints?: number;
  firepower?: number;
  bombardRate: number;
  paratroopersRange: number;
  fuel?: number;
  uk_happy?: number;
  uk_shield?: number;
  uk_food?: number;
  uk_gold?: number;
  roles?: string[];
  flags?: string[];
  obsolete_by?: string;
  pop_cost?: number;
  veteran_levels?: number;
}

export class RulesetUnitsService {
  private static instance: RulesetUnitsService;
  private cache = new Map<string, Record<string, UnitType>>();

  constructor(private readonly loader: Pick<RulesetLoader, 'loadUnitsRuleset'> = rulesetLoader) {}

  static getInstance(): RulesetUnitsService {
    if (!RulesetUnitsService.instance) {
      RulesetUnitsService.instance = new RulesetUnitsService();
    }
    return RulesetUnitsService.instance;
  }

  /**
   * Get all unit types for a ruleset, with backward compatibility mapping
   */
  getUnitTypes(rulesetName: string = 'classic'): Record<string, UnitType> {
    if (this.cache.has(rulesetName)) {
      return this.cache.get(rulesetName)!;
    }

    const ruleset = this.loader.loadUnitsRuleset(rulesetName);
    const mappedUnits: Record<string, UnitType> = {};

    for (const [unitId, unit] of Object.entries(ruleset.units)) {
      const unitClass = ruleset.unit_classes[unit.unit_class];
      if (!unitClass) {
        throw new Error(`Unit '${unitId}' references missing unit class '${unit.unit_class}'`);
      }
      mappedUnits[unitId] = this.mapRulesetUnit(unit, unitClass.flags);
    }

    this.cache.set(rulesetName, mappedUnits);
    return mappedUnits;
  }

  /**
   * Get a specific unit type
   */
  getUnitType(unitId: string, rulesetName: string = 'classic'): UnitType | undefined {
    const units = this.getUnitTypes(rulesetName);
    return units[unitId];
  }

  /**
   * Classify movement from the unit's loaded ruleset class.
   * Freeciv derives a class movement type from native terrain and extras, but
   * its movement enum is Land/Sea/Both; it has no distinct Air movement type.
   * This is an intentional CivJS compatibility adapter from the six classic
   * class IDs to the server's existing land/sea/air movement surface.
   * @reference reference/freeciv/common/unittype.h:131-139
   * @reference reference/freeciv/common/unittype.c:2953-2991
   * @reference reference/freeciv/data/classic/units.ruleset:143-188
   */
  getMovementType(unitId: string, rulesetName: string = 'classic'): UnitMovementType | undefined {
    const unitClass = this.getUnitType(unitId, rulesetName)?.rulesetUnitClass;
    if (!unitClass) return undefined;

    return this.mapMovementType(unitClass as UnitClass);
  }

  /**
   * Map ruleset unit to backward-compatible UnitType interface
   */
  private mapRulesetUnit(unit: UnitTypeRuleset, unitClassFlags: string[]): UnitType {
    return {
      id: unit.id,
      name: unit.name,
      cost: this.firstNonZero(unit.cost, unit.build_cost, 10),
      movement: this.firstNonZero(unit.movement, 1),
      combat: this.firstValue(unit.attack, unit.combat, 0), // Use attack as primary combat value
      attack: unit.attack,
      defense: unit.defense,
      range: this.firstNonZero(unit.range, 1), // Melee units need range 1 for adjacent combat
      sight: this.firstNonZero(unit.vision_radius_sq, unit.sight, 2),
      vision_radius_sq: unit.vision_radius_sq,
      visionLayer: unit.vision_layer,
      canFoundCity: this.hasFoundCityRole(unit),
      canBuildImprovements: this.hasWorkerRole(unit),
      unitClass: this.mapUnitClass(unit.unit_class, unit.unitClass as any, unit.flags),
      rulesetUnitClass: unit.unit_class,
      rulesetUnitClassFlags: [...unitClassFlags],
      requiredTech: this.firstValue(unit.required_tech, unit.requiredTech),
      transport_capacity: unit.transport_cap,
      cargoClasses: [...unit.cargo],
      targetClasses: [...unit.targets],
      combatBonuses: [...unit.bonuses],
      // Additional freeciv fields
      hitpoints: unit.hitpoints,
      firepower: unit.firepower,
      bombardRate: unit.bombard_rate,
      paratroopersRange: unit.paratroopers_range,
      fuel: unit.fuel,
      uk_happy: unit.uk_happy,
      uk_shield: unit.uk_shield,
      uk_food: unit.uk_food,
      uk_gold: unit.uk_gold,
      roles: unit.roles,
      flags: unit.flags,
      obsolete_by: unit.obsolete_by,
      pop_cost: unit.pop_cost,
      veteran_levels: unit.veteran_levels,
    };
  }

  private firstValue<T>(...values: Array<T | undefined | null>): T {
    return values.find(value => value !== undefined && value !== null) as T;
  }

  private firstNonZero<T>(...values: Array<T | undefined | null>): T {
    return values.find(value => value !== undefined && value !== null && value !== 0) as T;
  }

  private hasFoundCityRole(unit: UnitTypeRuleset): boolean {
    return Boolean(unit.canFoundCity || unit.roles?.includes('CitiesStartUnit'));
  }

  private hasWorkerRole(unit: UnitTypeRuleset): boolean {
    return Boolean(unit.canBuildImprovements || unit.flags?.includes('Workers' as any));
  }

  private mapMovementType(unitClass: UnitClass): UnitMovementType | undefined {
    switch (unitClass) {
      case 'Land':
        return 'land';
      case 'Sea':
      case 'Trireme':
        return 'sea';
      case 'Air':
      case 'Helicopter':
      case 'Missile':
        return 'air';
      default:
        return undefined;
    }
  }

  /**
   * Map freeciv unit class to our enum
   */
  private mapUnitClass(
    freecivClass: any,
    backwardClass?: 'military' | 'civilian' | 'naval' | 'air',
    flags?: string[]
  ): 'military' | 'civilian' | 'naval' | 'air' {
    if (backwardClass) return backwardClass;
    if (flags?.includes('NonMil')) return 'civilian';
    const mapped: Record<string, 'military' | 'naval' | 'air' | 'civilian'> = {
      Land: 'military',
      'Big Land': 'military',
      'Small Land': 'military',
      Sea: 'naval',
      Trireme: 'naval',
      Air: 'air',
      Helicopter: 'air',
    };
    return mapped[freecivClass] ?? 'civilian';
  }

  /**
   * Clear cache (useful for tests or ruleset changes)
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// Create singleton instance
export const rulesetUnitsService = RulesetUnitsService.getInstance();

// Provide backward-compatible exports that use the dynamic service
export const UNIT_TYPES = new Proxy({} as Record<string, UnitType>, {
  get(_, prop: string) {
    return rulesetUnitsService.getUnitType(prop, 'classic');
  },
  ownKeys(_) {
    return Reflect.ownKeys(rulesetUnitsService.getUnitTypes('classic'));
  },
  has(_, prop: string) {
    return rulesetUnitsService.getUnitType(prop, 'classic') !== undefined;
  },
  getOwnPropertyDescriptor(_, prop: string) {
    const unit = rulesetUnitsService.getUnitType(prop, 'classic');
    if (unit) {
      return {
        enumerable: true,
        configurable: true,
        value: unit,
      };
    }
    return undefined;
  },
});

export function getUnitType(unitTypeId: string): UnitType | undefined {
  return rulesetUnitsService.getUnitType(unitTypeId, 'classic');
}

export { UnitType as UnitTypeInterface };
