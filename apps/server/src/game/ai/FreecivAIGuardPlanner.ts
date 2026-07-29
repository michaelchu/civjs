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
        b.defenseDeficit - a.defenseDeficit ||
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
