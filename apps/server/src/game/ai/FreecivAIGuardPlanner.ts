import type { CityState } from '@game/managers/CityManager';
import type { Unit } from '@game/managers/UnitManager';
import type { UnitType } from '@game/services/RulesetUnitsService';
import type { AIUnitTask } from '@game/ai/FreecivAIStateStore';
import {
  assessCityDanger,
  unitDefenseRating,
  type CityDangerAssessment,
} from '@game/ai/FreecivAICityDangerPlanner';
import type { AIProfile } from '@game/ai/FreecivAIProfile';

export type { CityDangerAssessment } from '@game/ai/FreecivAICityDangerPlanner';

export interface GuardPlan {
  assessments: CityDangerAssessment[];
  assignments: Record<string, AIUnitTask>;
}

interface GuardPlanningContext {
  turn: number;
  cities: CityState[];
  friendlyUnits: Unit[];
  hostileUnits: Unit[];
  existingTasks: Record<string, AIUnitTask>;
  getType: (unitTypeId: string) => UnitType | undefined;
  distance: (fromX: number, fromY: number, toX: number, toY: number) => number;
  threatTravelTurns?: (unit: Unit, city: CityState) => number | undefined;
  defenderStrength?: (unit: Unit, type: UnitType) => number;
  attackerStrength?: (unit: Unit, type: UnitType, city: CityState) => number;
  unitAttackerStrength?: (unit: Unit, type: UnitType) => number;
  profile: AIProfile;
}

function isGuardCandidate(unit: Unit, type: UnitType | undefined): type is UnitType {
  return Boolean(
    type &&
      !unit.transportedBy &&
      !type.canFoundCity &&
      !type.canBuildImprovements &&
      (type.defense ?? type.combat ?? 0) > 0
  );
}

function movementDomain(type: UnitType): 'land' | 'sea' | 'air' {
  if (type.unitClass === 'naval') return 'sea';
  if (type.unitClass === 'air') return 'air';
  return 'land';
}

function canGuardUnit(guardType: UnitType, chargeType: UnitType): boolean {
  if (movementDomain(guardType) !== movementDomain(chargeType)) return false;
  if (guardType.movement < chargeType.movement) return false;
  if ((guardType.defense ?? guardType.combat ?? 0) <= (chargeType.defense ?? 0)) return false;
  const chargeAttacks = (chargeType.attack ?? chargeType.combat ?? 0) > 0;
  if (
    chargeAttacks &&
    (chargeType.transport_capacity ?? 0) === 0 &&
    (chargeType.attack ?? chargeType.combat ?? 0) <= (guardType.attack ?? guardType.combat ?? 0)
  ) {
    return false;
  }
  return true;
}

function chargeNeedsGuard(
  charge: Unit,
  context: GuardPlanningContext,
  chargeType: UnitType
): boolean {
  const task = context.existingTasks[charge.id];
  if (
    !task ||
    !['attack', 'diplomat', 'ferry', 'settle', 'worker'].includes(task.role) ||
    charge.transportedBy
  ) {
    return false;
  }
  if (task.role === 'diplomat') return true;
  const targetX = task.targetX ?? charge.x;
  const targetY = task.targetY ?? charge.y;
  const defense =
    context.defenderStrength?.(charge, chargeType) ?? unitDefenseRating(charge, chargeType);
  const danger = context.hostileUnits.reduce((sum, hostile) => {
    const hostileType = context.getType(hostile.unitTypeId);
    if (!hostileType) return sum;
    const turns = Math.ceil(
      context.distance(hostile.x, hostile.y, targetX, targetY) / Math.max(1, hostileType.movement)
    );
    if (turns > 1) return sum;
    return (
      sum +
      (context.unitAttackerStrength?.(hostile, hostileType) ??
        Math.max(0, hostileType.attack ?? hostileType.combat ?? 0) * Math.max(1, hostile.health))
    );
  }, 0);
  return danger >= defense;
}

export function chooseGuardRendezvous(
  guard: Unit,
  charge: Unit,
  chargeTask: AIUnitTask | undefined,
  getType: (unitTypeId: string) => UnitType | undefined,
  distance: (fromX: number, fromY: number, toX: number, toY: number) => number
): { x: number; y: number } {
  const goal =
    chargeTask?.targetX !== undefined && chargeTask.targetY !== undefined
      ? { x: chargeTask.targetX, y: chargeTask.targetY }
      : undefined;
  if (!goal) return { x: charge.x, y: charge.y };
  const guardType = getType(guard.unitTypeId);
  const chargeType = getType(charge.unitTypeId);
  if (!guardType || !chargeType) return { x: charge.x, y: charge.y };
  const guardToCharge = distance(guard.x, guard.y, charge.x, charge.y);
  const guardToGoal = distance(guard.x, guard.y, goal.x, goal.y);
  const chargeToGoal = distance(charge.x, charge.y, goal.x, goal.y);
  const guardBeatsCharge =
    guardToGoal / Math.max(1, guardType.movement) < chargeToGoal / Math.max(1, chargeType.movement);
  if (
    guardToGoal < guardToCharge ||
    (guardType.movement > chargeType.movement &&
      guardBeatsCharge &&
      guardToGoal / Math.max(1, guardType.movement) <
        guardToCharge / Math.max(1, guardType.movement))
  ) {
    return goal;
  }
  return { x: charge.x, y: charge.y };
}

/**
 * Assess city danger and keep or create persistent guard/charge assignments.
 *
 * Freeciv squares aggregate defense to give multiple defenders positive
 * feedback. We retain that shape while using CivJS's ruleset combat values.
 *
 * @reference reference/freeciv/ai/default/daimilitary.c:assess_defense_quadratic
 * @reference reference/freeciv/ai/default/daimilitary.c:assess_danger
 * @reference reference/freeciv/ai/default/daiguard.c
 */
export function planCityGuards(context: GuardPlanningContext): GuardPlan {
  const candidateUnits = context.friendlyUnits.filter(
    unit =>
      isGuardCandidate(unit, context.getType(unit.unitTypeId)) &&
      !['recover', 'retreat'].includes(context.existingTasks[unit.id]?.role ?? '')
  );
  const assessments = context.cities.map(city =>
    assessCityDanger({
      city,
      friendlyUnits: candidateUnits,
      threateningUnits: context.hostileUnits,
      profile: context.profile,
      getType: context.getType,
      defenderStrength: context.defenderStrength,
      attackerStrength: context.attackerStrength
        ? (unit, type) => context.attackerStrength!(unit, type, city)
        : undefined,
      travelTurns: (hostile, target) => {
        const planned = context.threatTravelTurns?.(hostile, target);
        if (context.threatTravelTurns) return planned;
        const type = context.getType(hostile.unitTypeId);
        if (!type) return undefined;
        return Math.ceil(
          context.distance(hostile.x, hostile.y, target.x, target.y) /
            Math.max(1, type.movement ?? 1)
        );
      },
    })
  );

  const cityById = new Map(context.cities.map(city => [city.id, city]));
  const friendlyUnitById = new Map(context.friendlyUnits.map(unit => [unit.id, unit]));
  const unitById = new Map(candidateUnits.map(unit => [unit.id, unit]));
  const assignments: Record<string, AIUnitTask> = {};
  const assignedUnits = new Set<string>();
  const guardedUnits = new Set<string>();

  // Preserve sane assignments so guards do not recalculate their charge every
  // turn. Destroyed/captured charges and transformed units are dismissed.
  for (const [unitId, task] of Object.entries(context.existingTasks)) {
    if (task.role !== 'guard' && task.role !== 'defend') continue;
    const unit = unitById.get(unitId);
    const city = task.targetId ? cityById.get(task.targetId) : undefined;
    const charge =
      task.role === 'guard' && task.targetId ? friendlyUnitById.get(task.targetId) : undefined;
    if (!unit || (!city && !charge)) continue;
    if (charge) {
      const guardType = context.getType(unit.unitTypeId);
      const chargeType = context.getType(charge.unitTypeId);
      if (
        !guardType ||
        !chargeType ||
        guardedUnits.has(charge.id) ||
        !chargeNeedsGuard(charge, context, chargeType) ||
        !canGuardUnit(guardType, chargeType)
      ) {
        continue;
      }
      guardedUnits.add(charge.id);
    }
    assignments[unitId] = task;
    assignedUnits.add(unitId);
  }

  const orderedCities = assessments
    .slice()
    .sort(
      (a, b) =>
        b.urgency - a.urgency ||
        b.defenseDeficit - a.defenseDeficit ||
        a.city.id.localeCompare(b.city.id)
    );
  for (const assessment of orderedCities) {
    let plannedDefense = candidateUnits
      .filter(unit => assignments[unit.id]?.targetId === assessment.city.id)
      .reduce((sum, unit) => {
        const type = context.getType(unit.unitTypeId);
        return type
          ? sum + (context.defenderStrength?.(unit, type) ?? unitDefenseRating(unit, type))
          : sum;
      }, 0);
    const neededLinearDefense = Math.sqrt(assessment.danger);

    while (plannedDefense < neededLinearDefense) {
      const guard = candidateUnits
        .filter(unit => !assignedUnits.has(unit.id))
        .map(unit => {
          const type = context.getType(unit.unitTypeId)!;
          const travel = context.distance(unit.x, unit.y, assessment.city.x, assessment.city.y);
          return {
            unit,
            rating: context.defenderStrength?.(unit, type) ?? unitDefenseRating(unit, type),
            travel,
          };
        })
        .sort(
          (a, b) => a.travel - b.travel || b.rating - a.rating || a.unit.id.localeCompare(b.unit.id)
        )[0];
      if (!guard) break;
      const stationed = guard.unit.x === assessment.city.x && guard.unit.y === assessment.city.y;
      assignments[guard.unit.id] = {
        role: stationed ? 'defend' : 'guard',
        targetId: assessment.city.id,
        targetX: assessment.city.x,
        targetY: assessment.city.y,
        assignedTurn: context.turn,
      };
      assignedUnits.add(guard.unit.id);
      plannedDefense += guard.rating;
    }

    // Keep one baseline defender when danger did not already retain one.
    // Surplus stationed defenders remain available as escorts.
    const hasAssignedCityDefender = candidateUnits.some(
      unit => assignments[unit.id]?.targetId === assessment.city.id
    );
    const baselineDefender = hasAssignedCityDefender
      ? undefined
      : candidateUnits
          .filter(
            unit =>
              unit.x === assessment.city.x &&
              unit.y === assessment.city.y &&
              !assignedUnits.has(unit.id)
          )
          .sort((left, right) => {
            const leftType = context.getType(left.unitTypeId)!;
            const rightType = context.getType(right.unitTypeId)!;
            const leftRating =
              context.defenderStrength?.(left, leftType) ?? unitDefenseRating(left, leftType);
            const rightRating =
              context.defenderStrength?.(right, rightType) ?? unitDefenseRating(right, rightType);
            return rightRating - leftRating || left.id.localeCompare(right.id);
          })[0];
    if (baselineDefender) {
      const defender = baselineDefender;
      assignments[defender.id] = {
        role: 'defend',
        targetId: assessment.city.id,
        targetX: assessment.city.x,
        targetY: assessment.city.y,
        assignedTurn: context.turn,
      };
      assignedUnits.add(defender.id);
    }
  }

  const charges = context.friendlyUnits
    .filter(charge => {
      const type = context.getType(charge.unitTypeId);
      return type && chargeNeedsGuard(charge, context, type) && !guardedUnits.has(charge.id);
    })
    .sort((left, right) => {
      const priority = (unit: Unit) =>
        context.existingTasks[unit.id]?.role === 'diplomat' ? 0 : 1;
      return priority(left) - priority(right) || left.id.localeCompare(right.id);
    });
  for (const charge of charges) {
    const chargeType = context.getType(charge.unitTypeId)!;
    const chargeDefense =
      context.defenderStrength?.(charge, chargeType) ?? unitDefenseRating(charge, chargeType);
    const guard = candidateUnits
      .filter(unit => {
        const type = context.getType(unit.unitTypeId)!;
        return (
          !assignedUnits.has(unit.id) &&
          unit.id !== charge.id &&
          type.roles?.includes('DefendGood') &&
          canGuardUnit(type, chargeType)
        );
      })
      .map(unit => {
        const type = context.getType(unit.unitTypeId)!;
        const travel = context.distance(unit.x, unit.y, charge.x, charge.y);
        const strength = context.defenderStrength?.(unit, type) ?? unitDefenseRating(unit, type);
        return {
          unit,
          travel,
          movement: type.movement,
          want:
            ((strength ** 2 - chargeDefense ** 2) * 100) /
            Math.max(1, strength ** 2) /
            Math.pow(2, Math.floor(travel / Math.max(1, type.movement * 2))),
        };
      })
      .filter(candidate => candidate.travel <= 3 * Math.max(1, candidate.movement))
      .sort(
        (left, right) =>
          right.want - left.want ||
          left.travel - right.travel ||
          left.unit.id.localeCompare(right.unit.id)
      )[0];
    if (!guard || guard.want <= 0) continue;
    assignments[guard.unit.id] = {
      role: 'guard',
      targetId: charge.id,
      targetX: charge.x,
      targetY: charge.y,
      assignedTurn: context.turn,
    };
    assignedUnits.add(guard.unit.id);
    guardedUnits.add(charge.id);
  }

  return { assessments, assignments };
}
