import { SINGLE_MOVE } from './MovementConstants';

export interface UnitType {
  id: string;
  name: string;
  cost: number;
  movement: number;
  combat: number;
  range: number;
  sight: number;
  canFoundCity: boolean;
  canBuildImprovements: boolean;
  unitClass: 'military' | 'civilian' | 'naval' | 'air';
  requiredTech?: string;
  transport_capacity?: number;
}

/**
 * Unit type definitions
 * @reference freeciv/data/classic/units.ruleset
 */
export const UNIT_TYPES: Record<string, UnitType> = {
  warrior: {
    id: 'warrior',
    name: 'Warrior',
    cost: 10,
    movement: 2 * SINGLE_MOVE, // 2 movement points = 6 fragments
    combat: 20,
    range: 1,
    sight: 2,
    canFoundCity: false,
    canBuildImprovements: false,
    unitClass: 'military',
  },
  settler: {
    id: 'settler',
    name: 'Settler',
    cost: 40,
    movement: 2 * SINGLE_MOVE, // 2 movement points = 6 fragments
    combat: 0,
    range: 0,
    sight: 2,
    canFoundCity: true,
    canBuildImprovements: false,
    unitClass: 'civilian',
  },
  scout: {
    id: 'scout',
    name: 'Scout',
    cost: 25,
    movement: 3 * SINGLE_MOVE, // 3 movement points = 9 fragments
    combat: 10,
    range: 1,
    sight: 3,
    canFoundCity: false,
    canBuildImprovements: false,
    unitClass: 'military',
  },
  worker: {
    id: 'worker',
    name: 'Worker',
    cost: 50,
    movement: 2 * SINGLE_MOVE, // 2 movement points = 6 fragments
    combat: 0,
    range: 0,
    sight: 2,
    canFoundCity: false,
    canBuildImprovements: true,
    unitClass: 'civilian',
  },
  engineer: {
    id: 'engineer',
    name: 'Engineer',
    cost: 100,
    movement: 3 * SINGLE_MOVE, // 3 movement points = 9 fragments
    combat: 0,
    range: 0,
    sight: 2,
    canFoundCity: false,
    canBuildImprovements: true,
    unitClass: 'civilian',
    requiredTech: 'engineering',
  },
  archer: {
    id: 'archer',
    name: 'Archer',
    cost: 50,
    movement: 2 * SINGLE_MOVE, // 2 movement points = 6 fragments
    combat: 15,
    range: 2,
    sight: 2,
    canFoundCity: false,
    canBuildImprovements: false,
    unitClass: 'military',
    requiredTech: 'archery',
  },
  spearman: {
    id: 'spearman',
    name: 'Spearman',
    cost: 45,
    movement: 2 * SINGLE_MOVE, // 2 movement points = 6 fragments
    combat: 25,
    range: 1,
    sight: 2,
    canFoundCity: false,
    canBuildImprovements: false,
    unitClass: 'military',
    requiredTech: 'bronzeWorking',
  },
  diplomat: {
    id: 'diplomat',
    name: 'Diplomat',
    cost: 30,
    movement: 2 * SINGLE_MOVE, // 2 movement points = 6 fragments
    combat: 0,
    range: 1,
    sight: 2,
    canFoundCity: false,
    canBuildImprovements: false,
    unitClass: 'civilian',
    requiredTech: 'writing',
  },
  caravan: {
    id: 'caravan',
    name: 'Caravan',
    cost: 50,
    movement: 1 * SINGLE_MOVE, // 1 movement point = 3 fragments
    combat: 0,
    range: 0,
    sight: 1,
    canFoundCity: false,
    canBuildImprovements: false,
    unitClass: 'civilian',
    requiredTech: 'currency',
  },
};

/**
 * Get unit type definition by ID
 */
export function getUnitType(unitTypeId: string): UnitType | undefined {
  return UNIT_TYPES[unitTypeId];
}
