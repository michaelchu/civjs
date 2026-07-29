import type { Unit } from '@game/managers/UnitManager';
import type { UnitType } from '@game/services/RulesetUnitsService';
import type { AIUnitTask } from '@game/ai/FreecivAIStateStore';

export interface HunterTarget {
  unit: Unit;
  distance: number;
  stackCost: number;
  stackThreat: number;
  want: number;
}

interface HunterPlanningContext {
  turn: number;
  friendlyUnits: Unit[];
  hostileUnits: Unit[];
  existingTasks: Record<string, AIUnitTask>;
  getType: (unitTypeId: string) => UnitType | undefined;
  distance: (fromX: number, fromY: number, toX: number, toY: number) => number;
}

function attackPower(unit: Unit, type: UnitType): number {
  return (
    Math.max(0, type.attack ?? type.combat ?? 0) *
    Math.max(1, type.firepower ?? 1) *
    Math.max(0.1, unit.health / 100) *
    (1 + unit.veteranLevel * 0.25)
  );
}

function isHunter(unit: Unit, type: UnitType | undefined): type is UnitType {
  return Boolean(
    type &&
      !unit.transportedBy &&
      (type.roles?.some(role => role.toLowerCase() === 'hunter') ||
        type.flags?.some(flag => flag.toLowerCase() === 'hunter'))
  );
}

function isValuableTarget(type: UnitType): boolean {
  return Boolean(
    (type.attack ?? type.combat ?? 0) > 0 ||
      (type.transport_capacity ?? 0) > 0 ||
      type.flags?.some(flag => flag.toLowerCase() === 'gameloss')
  );
}

/**
 * Assign specialist hunter units to threatening, valuable mobile stacks.
 *
 * Freeciv values the whole stack, heavily weights its attack threat, discounts
 * that threat by travel distance, and keeps the old target unless a better one
 * appears. CivJS applies the same decision shape to visible hostile units.
 *
 * @reference reference/freeciv/ai/default/daihunter.c:dai_hunter_juiciness
 * @reference reference/freeciv/ai/default/daihunter.c:dai_hunter_manage
 */
export function planHunters(context: HunterPlanningContext): {
  assignments: Record<string, AIUnitTask>;
  targets: Record<string, HunterTarget[]>;
} {
  const assignments: Record<string, AIUnitTask> = {};
  const targets: Record<string, HunterTarget[]> = {};
  const hostileById = new Map(context.hostileUnits.map(unit => [unit.id, unit]));
  const stackAt = (x: number, y: number) =>
    context.hostileUnits.filter(unit => unit.x === x && unit.y === y);

  for (const hunter of context.friendlyUnits
    .filter(unit => isHunter(unit, context.getType(unit.unitTypeId)))
    .sort((a, b) => a.id.localeCompare(b.id))) {
    const hunterType = context.getType(hunter.unitTypeId)!;
    const hunterCost = Math.max(1, hunterType.cost);
    const ranked: HunterTarget[] = [];
    for (const target of context.hostileUnits) {
      const targetType = context.getType(target.unitTypeId);
      if (!targetType || !isValuableTarget(targetType)) continue;
      const distance = context.distance(hunter.x, hunter.y, target.x, target.y);
      if (distance > Math.max(1, hunterType.movement) * 6) continue;
      if (
        hunterType.movement < Math.max(1, targetType.movement) &&
        context.existingTasks[hunter.id]?.targetId !== target.id
      ) {
        continue;
      }
      const stack = stackAt(target.x, target.y);
      let stackCost = 0;
      let rawThreat = 0;
      for (const member of stack) {
        const memberType = context.getType(member.unitTypeId);
        if (!memberType) continue;
        stackCost += Math.max(1, memberType.cost);
        rawThreat += attackPower(member, memberType);
        if (memberType.flags?.some(flag => flag.toLowerCase() === 'gameloss')) {
          stackCost += 1000;
          rawThreat += 5000;
        }
        if ((memberType.attack ?? memberType.combat ?? 0) > 0) rawThreat += 500;
      }
      if (stackCost < hunterCost) continue;
      const stackThreat = rawThreat * 9 + stackCost;
      const want = stackThreat / (distance + 1);
      if (want < hunterCost) continue;
      ranked.push({ unit: target, distance, stackCost, stackThreat, want });
    }
    ranked.sort(
      (a, b) => b.want - a.want || a.distance - b.distance || a.unit.id.localeCompare(b.unit.id)
    );
    targets[hunter.id] = ranked;
    const oldTargetId = context.existingTasks[hunter.id]?.targetId;
    const oldTarget = oldTargetId ? hostileById.get(oldTargetId) : undefined;
    const oldRank = oldTarget ? ranked.find(item => item.unit.id === oldTarget.id) : undefined;
    const chosen = oldRank && oldRank.want >= (ranked[0]?.want ?? 0) ? oldRank : ranked[0];
    if (!chosen) continue;
    assignments[hunter.id] = {
      role: 'hunter',
      targetId: chosen.unit.id,
      targetX: chosen.unit.x,
      targetY: chosen.unit.y,
      assignedTurn:
        oldTargetId === chosen.unit.id
          ? context.existingTasks[hunter.id].assignedTurn
          : context.turn,
    };
  }
  return { assignments, targets };
}
