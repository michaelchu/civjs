import type { Unit } from '@game/managers/UnitManager';
import type { UnitType } from '@game/services/RulesetUnitsService';
import type { AIUnitTask } from '@game/ai/FreecivAIStateStore';
import type { CityState } from '@game/managers/CityManager';

export interface HunterTarget {
  unit: Unit;
  distance: number;
  stackCost: number;
  stackThreat: number;
  want: number;
}

export interface HunterMissileLaunch {
  missile: Unit;
  target: Unit;
  primary: boolean;
}

interface HunterPlanningContext {
  turn: number;
  friendlyUnits: Unit[];
  hostileUnits: Unit[];
  existingTasks: Record<string, AIUnitTask>;
  getType: (unitTypeId: string) => UnitType | undefined;
  distance: (fromX: number, fromY: number, toX: number, toY: number) => number;
}

export interface HunterProductionContext {
  gameId: string;
  playerId: string;
  city: CityState;
  friendlyUnits: Unit[];
  hostileUnits: Unit[];
  unitTypes: Iterable<UnitType>;
  canBuild: (unitTypeId: string) => boolean;
  getType: (unitTypeId: string) => UnitType | undefined;
  distance: (fromX: number, fromY: number, toX: number, toY: number) => number;
  targetSelectionHandicap: boolean;
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
      if (hunterType.movement < Math.max(1, targetType.movement)) {
        const oldTask = context.existingTasks[hunter.id];
        const onInterceptVector =
          oldTask?.targetId === target.id &&
          oldTask.targetX !== undefined &&
          oldTask.targetY !== undefined &&
          distance < context.distance(hunter.x, hunter.y, oldTask.targetX, oldTask.targetY);
        if (!onInterceptVector) continue;
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

function isMissile(type: UnitType): boolean {
  return (
    type.rulesetUnitClass === 'Missile' &&
    type.rulesetUnitClassFlags.includes('Missile') &&
    (type.attack ?? type.combat ?? 0) > 0
  );
}

export function planHunterMissileLaunches(
  hunter: Unit,
  primaryTarget: Unit,
  friendlyUnits: Unit[],
  hostileUnits: Unit[],
  getType: (unitTypeId: string) => UnitType | undefined,
  distance: (fromX: number, fromY: number, toX: number, toY: number) => number
): HunterMissileLaunch[] {
  const hunterType = getType(hunter.unitTypeId);
  if (!hunterType) return [];
  const launches: HunterMissileLaunch[] = [];
  const claimedTargets = new Set<string>();
  for (const missile of friendlyUnits
    .filter(unit => unit.transportedBy === hunter.id)
    .sort((left, right) => left.id.localeCompare(right.id))) {
    const missileType = getType(missile.unitTypeId);
    if (!missileType || !isMissile(missileType)) continue;
    const reachable = hostileUnits
      .filter(
        target =>
          !claimedTargets.has(target.id) &&
          distance(missile.x, missile.y, target.x, target.y) <= Math.max(1, missile.movementLeft)
      )
      .map(target => {
        const targetType = getType(target.unitTypeId);
        if (!targetType) return undefined;
        const primary = target.id === primaryTarget.id;
        const canInterceptHunter =
          attackPower(target, targetType) >
            Math.max(0, hunterType.defense ?? hunterType.combat ?? 0) *
              Math.max(1, hunter.health / 100) &&
          distance(target.x, target.y, hunter.x, hunter.y) <=
            Math.max(1, targetType.movement + (targetType.range ?? 1));
        if (!primary && !canInterceptHunter) return undefined;
        return {
          target,
          primary,
          threat: attackPower(target, targetType),
          distance: distance(missile.x, missile.y, target.x, target.y),
        };
      })
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
      .sort(
        (left, right) =>
          Number(right.primary) - Number(left.primary) ||
          right.threat - left.threat ||
          left.distance - right.distance ||
          left.target.id.localeCompare(right.target.id)
      )[0];
    if (!reachable) continue;
    launches.push({ missile, target: reachable.target, primary: reachable.primary });
    claimedTargets.add(reachable.target.id);
  }
  return launches;
}

function canCarryMissile(hunterType: UnitType, missileType: UnitType): boolean {
  return (
    (hunterType.transport_capacity ?? 0) > 0 &&
    hunterType.cargoClasses.includes(missileType.rulesetUnitClass ?? '')
  );
}

/**
 * Feed hunter and hunter-carried missile wants into the shared city choice.
 * Cities with an existing local hunter replenish compatible missiles instead
 * of producing duplicate hunters.
 *
 * @reference reference/freeciv/ai/default/daihunter.c:dai_hunter_choice
 * @reference reference/freeciv/ai/default/daihunter.c:dai_hunter_missile_want
 */
export function rankHunterProduction(context: HunterProductionContext): Map<string, number> {
  const wants = new Map<string, number>();
  if (context.targetSelectionHandicap) return wants;
  const unitTypes = [...context.unitTypes];
  const localHunter = context.friendlyUnits.find(unit => {
    const type = context.getType(unit.unitTypeId);
    return (
      isHunter(unit, type) &&
      (unit.homeCityId === context.city.id ||
        (unit.x === context.city.x && unit.y === context.city.y))
    );
  });
  if (localHunter) {
    const hunterType = context.getType(localHunter.unitTypeId)!;
    for (const type of unitTypes) {
      if (!context.canBuild(type.id) || !isMissile(type) || !canCarryMissile(hunterType, type)) {
        continue;
      }
      const upkeep = (type.uk_happy ?? 0) + (type.uk_shield ?? 0) + (type.uk_gold ?? 0);
      let want =
        (Math.max(1, type.hitpoints ?? 100) *
          Math.min(30, Math.max(0, type.attack ?? type.combat ?? 0)) *
          Math.max(1, type.firepower ?? 1) *
          Math.max(1, type.movement)) /
          Math.max(1, type.cost + upkeep) +
        1;
      if (type.flags?.includes('FieldUnit')) want /= 2;
      wants.set(type.id, want);
    }
    return wants;
  }

  for (const type of unitTypes) {
    if (!context.canBuild(type.id) || !type.roles?.some(role => role.toLowerCase() === 'hunter')) {
      continue;
    }
    const virtual: Unit = {
      id: `virtual-hunter:${context.city.id}:${type.id}`,
      gameId: context.gameId,
      playerId: context.playerId,
      unitTypeId: type.id,
      x: context.city.x,
      y: context.city.y,
      movementLeft: type.movement,
      health: type.hitpoints ?? 100,
      veteranLevel: 0,
      experience: 0,
      fortified: false,
      homeCityId: context.city.id,
    };
    const plan = planHunters({
      turn: 0,
      friendlyUnits: [virtual],
      hostileUnits: context.hostileUnits,
      existingTasks: {},
      getType: context.getType,
      distance: context.distance,
    });
    const want = plan.targets[virtual.id]?.[0]?.want;
    if (want) wants.set(type.id, want);
  }
  return wants;
}
