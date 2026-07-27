/**
 * Service for accessing unit types from rulesets instead of hardcoded constants
 * Provides the same interface as the old UNIT_TYPES constant but loads dynamically from rulesets
 */

import { rulesetLoader, type RulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import type { UnitClass, UnitTypeRuleset } from '@shared/data/rulesets/schemas';

export type UnitMovementType = 'land' | 'sea' | 'air';

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
  canFoundCity: boolean;
  canBuildImprovements: boolean;
  unitClass: 'military' | 'civilian' | 'naval' | 'air';
  rulesetUnitClass?: string;
  /** @reference reference/freeciv/data/classic/units.ruleset:143-188 */
  rulesetUnitClassFlags: string[];
  requiredTech?: string;
  transport_capacity?: number;
  cargoClasses: string[];
  // Additional freeciv fields
  hitpoints?: number;
  firepower?: number;
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
      cost: unit.cost || unit.build_cost || 10,
      movement: unit.movement || 1,
      combat: unit.attack || unit.combat || 0, // Use attack as primary combat value
      attack: unit.attack,
      defense: unit.defense,
      range: unit.range || 1, // Melee units need range 1 for adjacent combat
      sight: unit.vision_radius_sq || unit.sight || 2,
      vision_radius_sq: unit.vision_radius_sq,
      canFoundCity: unit.canFoundCity || unit.roles?.includes('CitiesStartUnit') || false,
      canBuildImprovements:
        unit.canBuildImprovements || unit.flags?.includes('Workers' as any) || false,
      unitClass: this.mapUnitClass(unit.unit_class, unit.unitClass as any, unit.flags),
      rulesetUnitClass: unit.unit_class,
      rulesetUnitClassFlags: [...unitClassFlags],
      requiredTech: unit.required_tech || unit.requiredTech,
      transport_capacity: unit.transport_cap,
      cargoClasses: [...unit.cargo],
      // Additional freeciv fields
      hitpoints: unit.hitpoints,
      firepower: unit.firepower,
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
    // Use backward compatibility field first
    if (backwardClass) {
      return backwardClass;
    }

    // Check flags for civilian units (NonMil = Non-Military)
    if (flags && flags.includes('NonMil')) {
      return 'civilian';
    }

    // Map freeciv classes
    switch (freecivClass) {
      case 'Land':
      case 'Big Land':
      case 'Small Land':
        return 'military';
      case 'Sea':
      case 'Trireme':
        return 'naval';
      case 'Air':
      case 'Helicopter':
        return 'air';
      default:
        // For units with flags indicating civilian roles
        return 'civilian';
    }
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
    return rulesetUnitsService.getUnitType(prop);
  },
  ownKeys(_) {
    return Reflect.ownKeys(rulesetUnitsService.getUnitTypes());
  },
  has(_, prop: string) {
    return rulesetUnitsService.getUnitType(prop) !== undefined;
  },
  getOwnPropertyDescriptor(_, prop: string) {
    const unit = rulesetUnitsService.getUnitType(prop);
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
  return rulesetUnitsService.getUnitType(unitTypeId);
}

export { UnitType as UnitTypeInterface };
