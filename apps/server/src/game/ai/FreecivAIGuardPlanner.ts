import type { CityState } from '@game/managers/CityManager';
import type { Unit } from '@game/managers/UnitManager';
import type { UnitType } from '@game/services/RulesetUnitsService';
import type { AIUnitTask } from '@game/ai/FreecivAIStateStore';

export interface CityDangerAssessment {
  city: CityState;
  danger: number;
  urgency: number;
  defense: number;
  requiredDefense: number;
}

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
  dangerHandicap?: boolean;
}

function defenseRating(unit: Unit, type: UnitType): number {
  const veteranBonus = 1 + unit.veteranLevel * 0.25;
  const health = Math.max(0.1, unit.health / 100);
  return (
    Math.max(0, type.defense ?? type.combat ?? 0) *
    Math.max(1, type.hitpoints ?? 10) *
    veteranBonus *
    health
  );
}

function attackRating(unit: Unit, type: UnitType): number {
  const veteranBonus = 1 + unit.veteranLevel * 0.25;
  const health = Math.max(0.1, unit.health / 100);
  return (
    Math.max(0, type.attack ?? type.combat ?? 0) *
    Math.max(1, type.firepower ?? 1) *
    veteranBonus *
    health
  );
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
  const assessments = context.cities.map(city => {
    const defenders = candidateUnits.filter(unit => unit.x === city.x && unit.y === city.y);
    const linearDefense = defenders.reduce((sum, unit) => {
      const type = context.getType(unit.unitTypeId);
      return type ? sum + defenseRating(unit, type) : sum;
    }, 0);
    let danger = 0;
    let urgency = 0;
    for (const hostile of context.hostileUnits) {
      const type = context.getType(hostile.unitTypeId);
      if (!type) continue;
      const distance = context.distance(city.x, city.y, hostile.x, hostile.y);
      const movement = Math.max(1, type.movement ?? 1);
      const turns = Math.ceil(distance / movement);
      if (turns > 3) continue;
      danger += attackRating(hostile, type) / Math.max(1, turns);
      if (turns <= 1) urgency++;
    }
    if (context.dangerHandicap) {
      danger = Math.max(danger, 1);
      urgency = Math.max(urgency, 1);
    }
    return {
      city,
      danger,
      urgency,
      defense: linearDefense * linearDefense,
      requiredDefense: Math.max(1, danger * danger * (urgency > 0 ? 1.5 : 1)),
    };
  });

  const cityById = new Map(context.cities.map(city => [city.id, city]));
  const unitById = new Map(candidateUnits.map(unit => [unit.id, unit]));
  const assignments: Record<string, AIUnitTask> = {};
  const assignedUnits = new Set<string>();

  // Preserve sane assignments so guards do not recalculate their charge every
  // turn. Destroyed/captured charges and transformed units are dismissed.
  for (const [unitId, task] of Object.entries(context.existingTasks)) {
    if (task.role !== 'guard' && task.role !== 'defend') continue;
    const unit = unitById.get(unitId);
    const city = task.targetId ? cityById.get(task.targetId) : undefined;
    if (!unit || !city) continue;
    assignments[unitId] = task;
    assignedUnits.add(unitId);
  }

  const orderedCities = assessments
    .slice()
    .sort(
      (a, b) =>
        b.urgency - a.urgency ||
        b.requiredDefense - b.defense - (a.requiredDefense - a.defense) ||
        a.city.id.localeCompare(b.city.id)
    );
  for (const assessment of orderedCities) {
    let plannedDefense = candidateUnits
      .filter(
        unit =>
          assignments[unit.id]?.targetId === assessment.city.id ||
          (unit.x === assessment.city.x && unit.y === assessment.city.y)
      )
      .reduce((sum, unit) => {
        const type = context.getType(unit.unitTypeId);
        return type ? sum + defenseRating(unit, type) : sum;
      }, 0);
    const neededLinearDefense = Math.sqrt(assessment.requiredDefense);

    while (plannedDefense < neededLinearDefense) {
      const guard = candidateUnits
        .filter(unit => !assignedUnits.has(unit.id))
        .map(unit => {
          const type = context.getType(unit.unitTypeId)!;
          const travel = context.distance(unit.x, unit.y, assessment.city.x, assessment.city.y);
          return {
            unit,
            rating: defenseRating(unit, type),
            travel,
          };
        })
        .sort(
          (a, b) => a.travel - b.travel || b.rating - a.rating || a.unit.id.localeCompare(b.unit.id)
        )[0];
      if (!guard) break;
      assignments[guard.unit.id] = {
        role: 'guard',
        targetId: assessment.city.id,
        targetX: assessment.city.x,
        targetY: assessment.city.y,
        assignedTurn: context.turn,
      };
      assignedUnits.add(guard.unit.id);
      plannedDefense += guard.rating;
    }

    // Units already stationed in a city are explicitly retained as defenders
    // even if no traveling reinforcement is required.
    for (const defender of candidateUnits.filter(
      unit =>
        unit.x === assessment.city.x && unit.y === assessment.city.y && !assignedUnits.has(unit.id)
    )) {
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

  return { assessments, assignments };
}
