import { killDesire } from '@game/ai/FreecivAIMilitaryPlanner';
import { SINGLE_MOVE } from '@game/constants/MovementConstants';
import type { CityState } from '@game/managers/CityManager';
import type { Unit } from '@game/managers/UnitManager';
import type { UnitType } from '@game/services/RulesetUnitsService';

export interface AirRefuelPoint {
  id: string;
  kind: 'city' | 'airbase' | 'carrier';
  x: number;
  y: number;
  city?: CityState;
  carrier?: Unit;
  cargoClasses?: string[];
  remainingCapacity?: number;
  /** Turns required to restore this aircraft to full health at the point. */
  recoveryTurns?: (unit: Unit) => number;
  /** Freeciv grave-danger count for a city base. */
  graveDanger?: number;
  /** Number of friendly units currently defending a city base. */
  defenderCount?: number;
}

export type AirMission =
  | {
      unit: Unit;
      kind: 'hold';
      base: AirRefuelPoint;
      targetX: number;
      targetY: number;
      want: number;
    }
  | {
      unit: Unit;
      kind: 'return' | 'rebase';
      base: AirRefuelPoint;
      targetX: number;
      targetY: number;
      want: number;
    }
  | { unit: Unit; kind: 'strike'; target: Unit; targetX: number; targetY: number; want: number };

interface AirPlanningContext {
  friendlyUnits: Unit[];
  hostileUnits: Unit[];
  friendlyCities: CityState[];
  hostileCities: CityState[];
  refuelPoints?: AirRefuelPoint[];
  getType: (unitTypeId: string) => UnitType | undefined;
  distance: (fromX: number, fromY: number, toX: number, toY: number) => number;
  attackerRating?: (unit: Unit, type: UnitType) => number;
  defenderRating?: (attacker: Unit, defender: Unit, type: UnitType) => number;
  canAttack?: (attacker: Unit, defender: Unit) => boolean;
  hasOccupierSupport?: (city: CityState) => boolean;
  planesHandicap?: boolean;
}

export interface VirtualAirProductionContext {
  gameId: string;
  playerId: string;
  city: CityState;
  unitTypes: Iterable<UnitType>;
  hostileUnits: Unit[];
  hostileCities: CityState[];
  canBuild: (unitTypeId: string) => boolean;
  getType: (unitTypeId: string) => UnitType | undefined;
  distance: AirPlanningContext['distance'];
  attackerRating?: AirPlanningContext['attackerRating'];
  defenderRating?: AirPlanningContext['defenderRating'];
  canAttack?: AirPlanningContext['canAttack'];
  hasOccupierSupport?: AirPlanningContext['hasOccupierSupport'];
  planesHandicap?: boolean;
}

const SHIELD_AND_TRADE_SORTIE_COST = 53;

function combatPower(unit: Unit, type: UnitType): number {
  return (
    Math.max(0, type.attack ?? type.combat ?? 0) *
    Math.max(1, type.firepower ?? 1) *
    Math.max(1, type.hitpoints ?? 10) *
    Math.max(0.01, unit.health / 100)
  );
}

function defensePower(unit: Unit, type: UnitType): number {
  return (
    Math.max(0, type.defense ?? type.combat ?? 0) *
    Math.max(1, type.firepower ?? 1) *
    Math.max(1, type.hitpoints ?? 10) *
    Math.max(0.01, unit.health / 100)
  );
}

function fallbackRefuelPoints(cities: CityState[]): AirRefuelPoint[] {
  return cities.map(city => ({
    id: city.id,
    kind: 'city',
    x: city.x,
    y: city.y,
    city,
  }));
}

function currentRefuelPoint(unit: Unit, bases: AirRefuelPoint[]): AirRefuelPoint | undefined {
  if (unit.transportedBy) {
    return bases.find(base => base.kind === 'carrier' && base.id === unit.transportedBy);
  }
  return bases.find(base => base.kind !== 'carrier' && base.x === unit.x && base.y === unit.y);
}

function reachableBases(
  unit: Unit,
  type: UnitType,
  bases: AirRefuelPoint[],
  distance: AirPlanningContext['distance']
): AirRefuelPoint[] {
  return bases
    .filter(
      base =>
        base.kind !== 'carrier' ||
        base.carrier?.id === unit.transportedBy ||
        ((base.remainingCapacity ?? 0) > 0 &&
          base.cargoClasses?.includes(type.rulesetUnitClass ?? '') === true)
    )
    .filter(base => distance(unit.x, unit.y, base.x, base.y) * SINGLE_MOVE <= unit.movementLeft)
    .sort(
      (left, right) =>
        distance(unit.x, unit.y, left.x, left.y) - distance(unit.x, unit.y, right.x, right.y) ||
        left.id.localeCompare(right.id)
    );
}

function stackKey(unit: Pick<Unit, 'x' | 'y'>): string {
  return `${unit.x},${unit.y}`;
}

function rankAirTargets(
  context: AirPlanningContext,
  unit: Unit,
  type: UnitType,
  fromX: number,
  fromY: number
): Array<{ enemy: Unit; want: number }> {
  const hostileCityAt = new Map(context.hostileCities.map(city => [stackKey(city), city]));
  const stacks = new Map<string, Unit[]>();
  for (const enemy of context.hostileUnits) {
    const key = stackKey(enemy);
    const stack = stacks.get(key) ?? [];
    stack.push(enemy);
    stacks.set(key, stack);
  }

  const result: Array<{ enemy: Unit; want: number }> = [];
  for (const stack of stacks.values()) {
    const distance = context.distance(fromX, fromY, stack[0]!.x, stack[0]!.y);
    // Freeciv keeps one movement fragment in hand for the attack action.
    if (distance * SINGLE_MOVE >= unit.movementLeft) continue;
    const city = hostileCityAt.get(stackKey(stack[0]!));
    if (city && context.hasOccupierSupport && !context.hasOccupierSupport(city)) continue;

    const eligibleStack = stack.filter(enemy => context.canAttack?.(unit, enemy) ?? true);
    if (eligibleStack.length === 0) continue;
    const defender = eligibleStack
      .filter(enemy => context.getType(enemy.unitTypeId))
      .sort((left, right) => {
        const leftType = context.getType(left.unitTypeId)!;
        const rightType = context.getType(right.unitTypeId)!;
        const leftDefense =
          context.defenderRating?.(unit, left, leftType) ?? defensePower(left, leftType);
        const rightDefense =
          context.defenderRating?.(unit, right, rightType) ?? defensePower(right, rightType);
        return rightDefense - leftDefense || left.id.localeCompare(right.id);
      })[0];
    if (!defender) continue;
    const defenderType = context.getType(defender.unitTypeId)!;
    const benefit = eligibleStack.reduce(
      (sum, victim) => sum + Math.max(1, context.getType(victim.unitTypeId)?.cost ?? 1),
      0
    );
    const attack = (context.attackerRating?.(unit, type) ?? combatPower(unit, type)) ** 2;
    const vulnerability =
      (context.defenderRating?.(unit, defender, defenderType) ??
        defensePower(defender, defenderType)) ** 2;
    const suicideLoss = type.rulesetUnitClassFlags?.includes('Missile') ? type.cost : 0;
    const want =
      killDesire(
        Math.max(0, benefit - suicideLoss),
        attack,
        Math.max(1, type.cost),
        vulnerability,
        eligibleStack.length
      ) - SHIELD_AND_TRADE_SORTIE_COST;
    if (want > 0) result.push({ enemy: defender, want });
  }
  return result.sort(
    (left, right) => right.want - left.want || left.enemy.id.localeCompare(right.enemy.id)
  );
}

function strategicBase(
  context: AirPlanningContext,
  unit: Unit,
  type: UnitType,
  current: AirRefuelPoint,
  bases: AirRefuelPoint[]
): AirRefuelPoint | undefined {
  const lostHealth = Math.max(0, 100 - unit.health);
  if (lostHealth > 0) {
    const currentRecovery = current.recoveryTurns?.(unit) ?? Number.POSITIVE_INFINITY;
    const better = bases
      .map(base => ({
        base,
        turns: base.recoveryTurns?.(unit) ?? Number.POSITIVE_INFINITY,
        distance: context.distance(unit.x, unit.y, base.x, base.y),
      }))
      .filter(candidate => candidate.turns < currentRecovery)
      .sort(
        (left, right) =>
          left.turns - right.turns ||
          left.distance - right.distance ||
          left.base.id.localeCompare(right.base.id)
      )[0];
    if (better) return better.base;
  }

  const urgent = bases
    .filter(base => base.city && (base.graveDanger ?? 0) > Math.max(0, base.defenderCount ?? 0) * 2)
    .sort(
      (left, right) =>
        (right.graveDanger ?? 0) - (left.graveDanger ?? 0) ||
        context.distance(unit.x, unit.y, left.x, left.y) -
          context.distance(unit.x, unit.y, right.x, right.y) ||
        left.id.localeCompare(right.id)
    )[0];
  if (urgent && urgent.id !== current.id) return urgent;

  const currentWorth = rankAirTargets(context, unit, type, current.x, current.y)[0]?.want ?? 0;
  return bases
    .filter(base => base.id !== current.id)
    .map(base => ({
      base,
      worth: rankAirTargets(context, unit, type, base.x, base.y)[0]?.want ?? 0,
      distance: context.distance(unit.x, unit.y, base.x, base.y),
    }))
    .filter(candidate => candidate.worth > currentWorth)
    .sort(
      (left, right) =>
        right.worth - left.worth ||
        left.distance - right.distance ||
        left.base.id.localeCompare(right.base.id)
    )[0]?.base;
}

/**
 * Evaluate legal aircraft as virtual city-built attackers against targets
 * reachable in their first sortie.
 *
 * @reference reference/freeciv/ai/default/daiair.c:dai_choose_attacker_air
 */
export function rankVirtualAirProduction(
  context: VirtualAirProductionContext
): Map<string, number> {
  if (context.planesHandicap) return new Map();
  return new Map(
    [...context.unitTypes].flatMap(type => {
      if (
        type.unitClass !== 'air' ||
        (type.fuel ?? 0) <= 0 ||
        (type.attack ?? type.combat ?? 0) <= 0 ||
        !context.canBuild(type.id)
      ) {
        return [];
      }
      const virtual: Unit = {
        id: `virtual-air:${context.city.id}:${type.id}`,
        gameId: context.gameId,
        playerId: context.playerId,
        unitTypeId: type.id,
        x: context.city.x,
        y: context.city.y,
        movementLeft: type.movement * SINGLE_MOVE,
        health: 100,
        fuel: type.fuel,
        veteranLevel: 0,
        experience: 0,
        fortified: false,
        homeCityId: context.city.id,
      };
      const target = rankAirTargets(
        {
          friendlyUnits: [virtual],
          hostileUnits: context.hostileUnits,
          friendlyCities: [context.city],
          hostileCities: context.hostileCities,
          getType: context.getType,
          distance: context.distance,
          attackerRating: context.attackerRating,
          defenderRating: context.defenderRating,
          canAttack: context.canAttack,
          hasOccupierSupport: context.hasOccupierSupport,
        },
        virtual,
        type,
        virtual.x,
        virtual.y
      )[0];
      return target ? ([[type.id, target.want]] as const) : [];
    })
  );
}

/**
 * Plan Freeciv-style aircraft sorties and basing.
 *
 * Fueled aircraft outside a refuel point return immediately. At a refuel
 * point they wait for full fuel, then attack a profitable stack, reinforce a
 * city in grave danger, seek faster repairs, or rebase toward a better sortie.
 *
 * @reference reference/freeciv/ai/default/daiair.c
 * @reference reference/freeciv/ai/default/daiparadrop.c
 */
export function planAirMissions(context: AirPlanningContext): AirMission[] {
  const missions: AirMission[] = [];
  const bases = context.refuelPoints ?? fallbackRefuelPoints(context.friendlyCities);

  for (const unit of [...context.friendlyUnits].sort((a, b) => a.id.localeCompare(b.id))) {
    const type = context.getType(unit.unitTypeId);
    if (!type) continue;

    if (type.unitClass !== 'air') continue;
    const atBase = currentRefuelPoint(unit, bases);
    const reachable = reachableBases(unit, type, bases, context.distance);
    if (!atBase) {
      const base = reachable[0];
      if (base) {
        missions.push({
          unit,
          kind: 'return',
          base,
          targetX: base.x,
          targetY: base.y,
          want: Number.MAX_SAFE_INTEGER,
        });
      }
      continue;
    }

    const maximumFuel = type.fuel ?? 0;
    if (maximumFuel > 0 && (unit.fuel ?? maximumFuel) < maximumFuel) {
      missions.push({
        unit,
        kind: 'hold',
        base: atBase,
        targetX: atBase.x,
        targetY: atBase.y,
        want: Number.MAX_SAFE_INTEGER,
      });
      continue;
    }
    if (context.planesHandicap) continue;

    const target = rankAirTargets(context, unit, type, unit.x, unit.y)[0];
    if (target) {
      missions.push({
        unit,
        kind: 'strike',
        target: target.enemy,
        targetX: target.enemy.x,
        targetY: target.enemy.y,
        want: target.want,
      });
      continue;
    }

    const destination = strategicBase(context, unit, type, atBase, reachable);
    if (destination) {
      missions.push({
        unit,
        kind: 'rebase',
        base: destination,
        targetX: destination.x,
        targetY: destination.y,
        want: Number.MAX_SAFE_INTEGER - 1,
      });
    }
  }
  return missions;
}
