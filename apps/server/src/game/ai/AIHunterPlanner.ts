/**
 * @module server/game/ai/AIHunterPlanner
 * Implements AIHunter Planner decision logic for AI-controlled players.
 */
import type { Unit } from '@game/units/UnitTypes';
import type { UnitType } from '@game/services/RulesetUnitsService';
import type { AIUnitTask } from '@game/ai/AIStateStore';
import type { CityState } from '@game/cities/CityTypes';

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

function canHunterReachTarget(
  hunter: Unit,
  hunterType: UnitType,
  target: Unit,
  targetType: UnitType,
  context: HunterPlanningContext
): boolean {
  const distance = context.distance(hunter.x, hunter.y, target.x, target.y);
  if (distance > Math.max(1, hunterType.movement) * 6) return false;
  if (hunterType.movement >= Math.max(1, targetType.movement)) return true;
  const oldTask = context.existingTasks[hunter.id];
  return Boolean(
    oldTask?.targetId === target.id &&
    oldTask.targetX !== undefined &&
    oldTask.targetY !== undefined &&
    distance < context.distance(hunter.x, hunter.y, oldTask.targetX, oldTask.targetY)
  );
}

function stackValue(
  stack: Unit[],
  getType: (unitTypeId: string) => UnitType | undefined
): { cost: number; threat: number } {
  let cost = 0;
  let threat = 0;
  for (const member of stack) {
    const type = getType(member.unitTypeId);
    if (!type) continue;
    cost += Math.max(1, type.cost);
    threat += attackPower(member, type);
    if (type.flags?.some(flag => flag.toLowerCase() === 'gameloss')) {
      cost += 1000;
      threat += 5000;
    }
    if ((type.attack ?? type.combat ?? 0) > 0) threat += 500;
  }
  return { cost, threat };
}

function rankHunterTargets(
  hunter: Unit,
  hunterType: UnitType,
  context: HunterPlanningContext
): HunterTarget[] {
  const hunterCost = Math.max(1, hunterType.cost);
  return context.hostileUnits
    .map(target => {
      const targetType = context.getType(target.unitTypeId);
      if (!targetType || !isValuableTarget(targetType)) return undefined;
      if (!canHunterReachTarget(hunter, hunterType, target, targetType, context)) return undefined;
      const distance = context.distance(hunter.x, hunter.y, target.x, target.y);
      const stack = context.hostileUnits.filter(unit => unit.x === target.x && unit.y === target.y);
      const value = stackValue(stack, context.getType);
      if (value.cost < hunterCost) return undefined;
      const stackThreat = value.threat * 9 + value.cost;
      const want = stackThreat / (distance + 1);
      if (want < hunterCost) return undefined;
      return { unit: target, distance, stackCost: value.cost, stackThreat, want };
    })
    .filter((target): target is HunterTarget => Boolean(target))
    .sort(
      (a, b) => b.want - a.want || a.distance - b.distance || a.unit.id.localeCompare(b.unit.id)
    );
}

function chooseHunterTarget(
  hunter: Unit,
  ranked: HunterTarget[],
  context: HunterPlanningContext
): HunterTarget | undefined {
  const oldTargetId = context.existingTasks[hunter.id]?.targetId;
  const oldRank = oldTargetId ? ranked.find(item => item.unit.id === oldTargetId) : undefined;
  return oldRank && oldRank.want >= (ranked[0]?.want ?? 0) ? oldRank : ranked[0];
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

  for (const hunter of context.friendlyUnits
    .filter(unit => isHunter(unit, context.getType(unit.unitTypeId)))
    .sort((a, b) => a.id.localeCompare(b.id))) {
    const hunterType = context.getType(hunter.unitTypeId)!;
    const ranked = rankHunterTargets(hunter, hunterType, context);
    targets[hunter.id] = ranked;
    const oldTargetId = context.existingTasks[hunter.id]?.targetId;
    const chosen = chooseHunterTarget(hunter, ranked, context);
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

function rankMissileProduction(
  context: HunterProductionContext,
  hunter: Unit,
  unitTypes: UnitType[]
): Map<string, number> {
  const wants = new Map<string, number>();
  const hunterType = context.getType(hunter.unitTypeId)!;
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

function createVirtualHunter(context: HunterProductionContext, type: UnitType): Unit {
  return {
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
}

function rankNewHunterProduction(
  context: HunterProductionContext,
  unitTypes: UnitType[]
): Map<string, number> {
  const wants = new Map<string, number>();
  for (const type of unitTypes) {
    if (!context.canBuild(type.id) || !type.roles?.some(role => role.toLowerCase() === 'hunter')) {
      continue;
    }
    const virtual = createVirtualHunter(context, type);
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

/**
 * Feed hunter and hunter-carried missile wants into the shared city choice.
 * Cities with an existing local hunter replenish compatible missiles instead
 * of producing duplicate hunters.
 *
 * @reference reference/freeciv/ai/default/daihunter.c:dai_hunter_choice
 * @reference reference/freeciv/ai/default/daihunter.c:dai_hunter_missile_want
 */
export function rankHunterProduction(context: HunterProductionContext): Map<string, number> {
  if (context.targetSelectionHandicap) return new Map();
  const unitTypes = [...context.unitTypes];
  const localHunter = context.friendlyUnits.find(unit => {
    const type = context.getType(unit.unitTypeId);
    return (
      isHunter(unit, type) &&
      (unit.homeCityId === context.city.id ||
        (unit.x === context.city.x && unit.y === context.city.y))
    );
  });
  return localHunter
    ? rankMissileProduction(context, localHunter, unitTypes)
    : rankNewHunterProduction(context, unitTypes);
}
