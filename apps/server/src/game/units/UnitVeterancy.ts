import type { VeteranLevel } from './UnitTypes';

const VETERAN_LEVELS: readonly VeteranLevel[] = [
  { name: 'Green', powerFactor: 1.0, moveBonus: 0, experienceRequired: 0 },
  { name: 'Veteran', powerFactor: 1.5, moveBonus: 0, experienceRequired: 20 },
  { name: 'Hardened', powerFactor: 1.75, moveBonus: 1, experienceRequired: 40 },
  { name: 'Elite', powerFactor: 2.0, moveBonus: 1, experienceRequired: 80 },
];

export function getVeteranLevel(level: number): VeteranLevel {
  return VETERAN_LEVELS[Math.min(level, VETERAN_LEVELS.length - 1)];
}
