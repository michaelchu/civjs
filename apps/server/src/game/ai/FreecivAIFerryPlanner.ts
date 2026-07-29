import type { Unit } from '@game/managers/UnitManager';
import type { UnitType } from '@game/services/RulesetUnitsService';
import type { AIUnitTask } from '@game/ai/FreecivAIStateStore';

export interface FerryAssignment {
  ferry: Unit;
  passenger: Unit;
  destinationX: number;
  destinationY: number;
  missionRole: AIUnitTask['role'];
  phase: 'rendezvous' | 'embarked' | 'delivery';
}

export interface FerryBeachheadValue {
  missionRole: AIUnitTask['role'];
  distance: number;
  enemyThreat: number;
  friendlySupport: number;
  landingDefense: number;
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
      (['settle', 'attack', 'guard', 'diplomat'].includes(task.role) ||
        (['worker', 'caravan'].includes(task.role) && task.transportRequired === true))
  );
}

export function scoreFerryBeachhead(value: FerryBeachheadValue): number {
  const invasion = value.missionRole === 'attack' || value.missionRole === 'guard';
  return (
    value.distance * 100 +
    (invasion ? value.enemyThreat * 4 - value.friendlySupport - value.landingDefense / 4 : 0)
  );
}

interface FerryPlanningState {
  assignments: FerryAssignment[];
  plannedCapacity: Map<string, number>;
  assignedPassengers: Set<string>;
}

function retainFerryAssignments(
  context: FerryPlanningContext,
  ferries: Unit[],
  byId: ReadonlyMap<string, Unit>,
  state: FerryPlanningState
): void {
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
    state.assignments.push({
      ferry,
      passenger,
      destinationX: passengerTask.targetX!,
      destinationY: passengerTask.targetY!,
      missionRole: passengerTask.role,
      phase: passenger.transportedBy === ferry.id ? 'delivery' : 'rendezvous',
    });
    const occupiedCapacity = passenger.transportedBy ? 0 : 1;
    state.plannedCapacity.set(
      ferry.id,
      Math.max(0, (state.plannedCapacity.get(ferry.id) ?? 0) - occupiedCapacity)
    );
    state.assignedPassengers.add(passenger.id);
  }
}

function assignPassenger(
  context: FerryPlanningContext,
  passenger: Unit,
  ferries: Unit[],
  byId: ReadonlyMap<string, Unit>,
  state: FerryPlanningState
): void {
  const task = context.existingTasks[passenger.id]!;
  const embarkedFerry = passenger.transportedBy ? byId.get(passenger.transportedBy) : undefined;
  if (embarkedFerry) {
    state.assignments.push({
      ferry: embarkedFerry,
      passenger,
      destinationX: task.targetX!,
      destinationY: task.targetY!,
      missionRole: task.role,
      phase: 'delivery',
    });
    state.assignedPassengers.add(passenger.id);
    return;
  }
  if (passenger.transportedBy) return;
  const passengerType = context.getType(passenger.unitTypeId)!;
  const ferry = ferries
    .filter(
      unit =>
        (state.plannedCapacity.get(unit.id) ?? 0) > 0 &&
        canCarry(context.getType(unit.unitTypeId)!, passengerType)
    )
    .sort(
      (a, b) =>
        context.distance(a.x, a.y, passenger.x, passenger.y) -
          context.distance(b.x, b.y, passenger.x, passenger.y) || a.id.localeCompare(b.id)
    )[0];
  if (!ferry) return;
  state.assignments.push({
    ferry,
    passenger,
    destinationX: task.targetX!,
    destinationY: task.targetY!,
    missionRole: task.role,
    phase: ferry.x === passenger.x && ferry.y === passenger.y ? 'embarked' : 'rendezvous',
  });
  state.plannedCapacity.set(ferry.id, Math.max(0, (state.plannedCapacity.get(ferry.id) ?? 0) - 1));
  state.assignedPassengers.add(passenger.id);
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
  const state: FerryPlanningState = {
    assignments: [],
    plannedCapacity: new Map(
      ferries.map(ferry => [ferry.id, Math.max(0, context.capacityRemaining(ferry.id))])
    ),
    assignedPassengers: new Set(),
  };
  retainFerryAssignments(context, ferries, byId, state);
  for (const passenger of passengers
    .filter(unit => !state.assignedPassengers.has(unit.id))
    .sort((a, b) => a.id.localeCompare(b.id))) {
    assignPassenger(context, passenger, ferries, byId, state);
  }
  return state.assignments;
}
