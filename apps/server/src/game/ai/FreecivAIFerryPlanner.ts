import type { Unit } from '@game/managers/UnitManager';
import type { UnitType } from '@game/services/RulesetUnitsService';
import type { AIUnitTask } from '@game/ai/FreecivAIStateStore';

export interface FerryAssignment {
  ferry: Unit;
  passenger: Unit;
  destinationX: number;
  destinationY: number;
  phase: 'rendezvous' | 'embarked' | 'delivery';
}

interface FerryPlanningContext {
  friendlyUnits: Unit[];
  existingTasks: Record<string, AIUnitTask>;
  getType: (unitTypeId: string) => UnitType | undefined;
  capacityRemaining: (ferryId: string) => number;
  distance: (fromX: number, fromY: number, toX: number, toY: number) => number;
}

function canCarry(ferryType: UnitType, passengerType: UnitType): boolean {
  return (
    (ferryType.transport_capacity ?? 0) > 0 &&
    Boolean(
      passengerType.rulesetUnitClass &&
        ferryType.cargoClasses.includes(passengerType.rulesetUnitClass)
    )
  );
}

function hasOverseasMission(task: AIUnitTask | undefined): task is AIUnitTask {
  return Boolean(
    task &&
      task.role !== 'ferry' &&
      task.targetX !== undefined &&
      task.targetY !== undefined &&
      ['settle', 'attack', 'guard', 'diplomat'].includes(task.role)
  );
}

/**
 * Match ferryboats to passengers which already have a strategic destination.
 * Existing valid pairs are retained, then unassigned demand is matched by
 * rendezvous distance and remaining capacity.
 *
 * @reference reference/freeciv/ai/default/daiferry.c:aiferry_find_boat
 * @reference reference/freeciv/ai/default/daiferry.c:dai_go_by_boat
 */
export function planFerries(context: FerryPlanningContext): FerryAssignment[] {
  const byId = new Map(context.friendlyUnits.map(unit => [unit.id, unit]));
  const ferries = context.friendlyUnits.filter(unit => {
    const type = context.getType(unit.unitTypeId);
    return Boolean(type && (type.transport_capacity ?? 0) > 0 && type.unitClass === 'naval');
  });
  const passengers = context.friendlyUnits.filter(unit => {
    const type = context.getType(unit.unitTypeId);
    return Boolean(
      type && type.unitClass !== 'naval' && hasOverseasMission(context.existingTasks[unit.id])
    );
  });
  const assignments: FerryAssignment[] = [];
  const assignedFerries = new Set<string>();
  const assignedPassengers = new Set<string>();

  for (const ferry of ferries) {
    const task = context.existingTasks[ferry.id];
    const passenger = task?.role === 'ferry' && task.targetId ? byId.get(task.targetId) : undefined;
    const passengerTask = passenger ? context.existingTasks[passenger.id] : undefined;
    const ferryType = context.getType(ferry.unitTypeId);
    const passengerType = passenger ? context.getType(passenger.unitTypeId) : undefined;
    if (
      !passenger ||
      !ferryType ||
      !passengerType ||
      !hasOverseasMission(passengerTask) ||
      !canCarry(ferryType, passengerType)
    ) {
      continue;
    }
    assignments.push({
      ferry,
      passenger,
      destinationX: passengerTask.targetX!,
      destinationY: passengerTask.targetY!,
      phase: passenger.transportedBy === ferry.id ? 'delivery' : 'rendezvous',
    });
    assignedFerries.add(ferry.id);
    assignedPassengers.add(passenger.id);
  }

  for (const passenger of passengers
    .filter(unit => !assignedPassengers.has(unit.id))
    .sort((a, b) => a.id.localeCompare(b.id))) {
    const passengerType = context.getType(passenger.unitTypeId)!;
    const task = context.existingTasks[passenger.id]!;
    if (passenger.transportedBy) {
      const ferry = byId.get(passenger.transportedBy);
      if (ferry && !assignedFerries.has(ferry.id)) {
        assignments.push({
          ferry,
          passenger,
          destinationX: task.targetX!,
          destinationY: task.targetY!,
          phase: 'delivery',
        });
        assignedFerries.add(ferry.id);
        assignedPassengers.add(passenger.id);
      }
      continue;
    }
    const ferry = ferries
      .filter(
        unit =>
          !assignedFerries.has(unit.id) &&
          context.capacityRemaining(unit.id) > 0 &&
          canCarry(context.getType(unit.unitTypeId)!, passengerType)
      )
      .sort(
        (a, b) =>
          context.distance(a.x, a.y, passenger.x, passenger.y) -
            context.distance(b.x, b.y, passenger.x, passenger.y) || a.id.localeCompare(b.id)
      )[0];
    if (!ferry) continue;
    assignments.push({
      ferry,
      passenger,
      destinationX: task.targetX!,
      destinationY: task.targetY!,
      phase: ferry.x === passenger.x && ferry.y === passenger.y ? 'embarked' : 'rendezvous',
    });
    assignedFerries.add(ferry.id);
    assignedPassengers.add(passenger.id);
  }
  return assignments;
}
