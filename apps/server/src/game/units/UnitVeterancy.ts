/**
 * @module server/game/units/UnitVeterancy
 * Defines Unit Veterancy unit behavior and contracts.
 */
import type { UnitType } from '@game/services/RulesetUnitsService';
import type { VeteranLevel } from './UnitTypes';

const LEGACY_VETERAN_LEVELS: readonly VeteranLevel[] = [
  {
    name: 'Green',
    powerFactor: 1.0,
    moveBonus: 0,
    baseRaiseChance: 50,
    workRaiseChance: 0,
    experienceRequired: 0,
  },
  {
    name: 'Veteran',
    powerFactor: 1.5,
    moveBonus: 0,
    baseRaiseChance: 33,
    workRaiseChance: 0,
    experienceRequired: 20,
  },
  {
    name: 'Hardened',
    powerFactor: 1.75,
    moveBonus: 1,
    baseRaiseChance: 20,
    workRaiseChance: 0,
    experienceRequired: 40,
  },
  {
    name: 'Elite',
    powerFactor: 2.0,
    moveBonus: 1,
    baseRaiseChance: 0,
    workRaiseChance: 0,
    experienceRequired: 80,
  },
];

/** Returns a unit's source-derived veteran profile, with legacy fallback. */
export function getVeteranLevels(unitType: UnitType | undefined): readonly VeteranLevel[] {
  return unitType?.veteranLevels?.length ? unitType.veteranLevels : LEGACY_VETERAN_LEVELS;
}

export function getVeteranLevel(unitType: UnitType | undefined, level: number): VeteranLevel {
  const levels = getVeteranLevels(unitType);
  return levels[Math.max(0, Math.min(level, levels.length - 1))]!;
}

export function getVeteranLevelCount(unitType: UnitType | undefined): number {
  return getVeteranLevels(unitType).length;
}
