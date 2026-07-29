import type { AIUnitTask } from '@game/ai/AIStateStore';
import type { CityState } from '@game/managers/CityManager';
import type { Unit } from '@game/managers/UnitManager';
import type { PathfindingResult } from '@game/managers/PathfindingManager';
import type { UnitType } from '@game/services/RulesetUnitsService';

export interface RecoveryAssignment {
  unit: Unit;
  city: CityState;
  path: PathfindingResult;
}

export interface RecoveryPlanningContext {
  turn: number;
  units: Unit[];
  cities: CityState[];
  existingTasks: Record<string, AIUnitTask>;
  getType: (unitTypeId: string) => UnitType | undefined;
  findPath: (unit: Unit, targetX: number, targetY: number) => Promise<PathfindingResult>;
  hasAcceleratedRegeneration: (unit: Unit, city: CityState) => boolean;
}

function isSpecializedMilitary(type: UnitType): boolean {
  return [
    type.canBuildImprovements,
    type.canFoundCity,
    Number(type.transport_capacity) > 0,
    Number(type.fuel) > 0,
    Number(type.paratroopersRange) > 0,
    type.rulesetUnitClass === 'Helicopter',
    type.flags?.includes('Diplomat') === true,
    type.roles?.some(role => role.toLowerCase() === 'hunter') === true,
  ].includes(true);
}

function hasMilitaryStrength(type: UnitType): boolean {
  return [type.attack, type.defense, type.combat].some(value => Number(value) > 0);
}

function isOrdinaryMilitary(unit: Unit, type: UnitType | undefined): type is UnitType {
  if (!type || unit.transportedBy) return false;
  if (isSpecializedMilitary(type)) return false;
  return ['military', 'naval'].includes(type.unitClass) && hasMilitaryStrength(type);
}

/**
 * Assign ordinary military units below one quarter health to recovery and
 * retain that job until they reach full health. Recovery cities use Freeciv's
 * path-cost score, including its threefold penalty when the destination has
 * no accelerated HP regeneration.
 *
 * @reference reference/freeciv/ai/default/daiunit.c:dai_military_findjob
 * @reference reference/freeciv/ai/default/daiunit.c:find_nearest_safe_city
 * @reference reference/freeciv/ai/default/daiunit.c:dai_manage_hitpoint_recovery
 */
export async function planMilitaryRecovery(context: RecoveryPlanningContext): Promise<{
  assignments: RecoveryAssignment[];
  tasks: Record<string, AIUnitTask>;
}> {
  const assignments: RecoveryAssignment[] = [];
  const tasks: Record<string, AIUnitTask> = {};

  for (const unit of context.units.slice().sort((left, right) => left.id.localeCompare(right.id))) {
    const wasRecovering = context.existingTasks[unit.id]?.role === 'recover';
    if (!isOrdinaryMilitary(unit, context.getType(unit.unitTypeId))) continue;
    if ((!wasRecovering && unit.health >= 25) || unit.health >= 100) continue;

    const candidates = await Promise.all(
      context.cities.map(async city => {
        const path = await context.findPath(unit, city.x, city.y);
        return {
          city,
          path,
          score: path.totalCost * (context.hasAcceleratedRegeneration(unit, city) ? 1 : 3),
        };
      })
    );
    const chosen = candidates
      .filter(candidate => candidate.path.valid)
      .sort(
        (left, right) =>
          left.score - right.score ||
          left.path.totalCost - right.path.totalCost ||
          left.city.id.localeCompare(right.city.id)
      )[0];
    if (!chosen) continue;

    tasks[unit.id] = {
      role: 'recover',
      targetId: chosen.city.id,
      targetX: chosen.city.x,
      targetY: chosen.city.y,
      assignedTurn: wasRecovering ? context.existingTasks[unit.id].assignedTurn : context.turn,
    };
    assignments.push({ unit, city: chosen.city, path: chosen.path });
  }

  return { assignments, tasks };
}
