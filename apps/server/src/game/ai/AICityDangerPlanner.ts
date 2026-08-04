/**
 * @module server/game/ai/AICityDangerPlanner
 * Implements AICity Danger Planner decision logic for AI-controlled players.
 */
import type { AIProfile } from '@game/ai/AIProfile';
import type { CityState } from '@game/cities/CityTypes';
import type { GameInstance } from '@game/runtime/GameTypes';
import type { Unit } from '@game/units/UnitTypes';
import type { UnitType } from '@game/services/RulesetUnitsService';
import { getVeteranLevel } from '@game/units/UnitVeterancy';
import type { AIPlanningBudgetLike } from '@game/ai/AIPlanningBudget';

export interface CityDangerAssessment {
  city: CityState;
  danger: number;
  urgency: number;
  graveDanger: number;
  defense: number;
  defenseDeficit: number;
  assessTurns: number;
}

export interface CityDangerPlanningContext {
  city: CityState;
  friendlyUnits: Unit[];
  threateningUnits: Unit[];
  profile: AIProfile;
  getType: (unitTypeId: string) => UnitType | undefined;
  travelTurns: (unit: Unit, city: CityState) => number | undefined;
  defenderStrength?: (unit: Unit, type: UnitType) => number;
  attackerStrength?: (unit: Unit, type: UnitType) => number;
}

export interface CityThreatTravelPlanningContext {
  cities: CityState[];
  threateningUnits: Unit[];
  getType: (unitTypeId: string) => UnitType | undefined;
  getUnit: (unitId: string) => Unit | undefined;
  distance: (fromX: number, fromY: number, toX: number, toY: number) => number;
  findPath: (
    unit: Unit,
    targetX: number,
    targetY: number
  ) => Promise<{ valid: boolean; estimatedTurns: number }>;
  budget?: AIPlanningBudgetLike;
}

function healthPoints(unit: Unit, type: UnitType): number {
  return Math.max(1, type.hitpoints ?? 10) * Math.max(0.01, unit.health / 100);
}

export function unitAttackRating(unit: Unit, type: UnitType): number {
  const veteranBonus = getVeteranLevel(type, unit.veteranLevel).powerFactor;
  return (
    Math.max(0, type.attack ?? type.combat ?? 0) *
    healthPoints(unit, type) *
    Math.max(1, type.firepower ?? 1) *
    veteranBonus
  );
}

export function unitDefenseRating(unit: Unit, type: UnitType): number {
  const veteranBonus = getVeteranLevel(type, unit.veteranLevel).powerFactor;
  const badCityDefender = type.flags?.includes('BadCityDefender') === true;
  const firepower = badCityDefender
    ? Math.min(1, Math.max(1, type.firepower ?? 1)) / 2
    : Math.max(1, type.firepower ?? 1);
  return (
    Math.max(0, type.defense ?? type.combat ?? 0) *
    healthPoints(unit, type) *
    firepower *
    veteranBonus
  );
}

export function dangerAssessmentTurns(profile: AIProfile): number {
  if (
    profile.level === 'hard' ||
    profile.level === 'experimental' ||
    profile.level === 'cheating'
  ) {
    return 6;
  }
  return profile.handicaps.has('assess_danger_limited') ? 2 : 3;
}

export function cityThreatTravelKey(unitId: string, cityId: string): string {
  return `${unitId}:${cityId}`;
}

/**
 * Resolve Freeciv's danger move time through authoritative movement paths,
 * including paradrop reach and the carrier path of embarked attackers.
 *
 * @reference reference/freeciv/ai/default/daimilitary.c:assess_danger_unit
 */
export async function buildCityThreatTravelTimes(
  context: CityThreatTravelPlanningContext
): Promise<Map<string, number>> {
  const travelTimes = new Map<string, number>();
  const pathMemo = new Map<string, Promise<{ valid: boolean; estimatedTurns: number }>>();
  const findMemoizedPath = (unit: Unit, city: CityState) => {
    const key = `${unit.id}:${city.id}:${city.x},${city.y}`;
    const existing = pathMemo.get(key);
    if (existing) return existing;
    const path = context.findPath(unit, city.x, city.y);
    pathMemo.set(key, path);
    return path;
  };

  for (const unit of context.threateningUnits) {
    for (const city of context.cities) {
      if (context.budget && !context.budget.consumePlanningStep()) return travelTimes;
      const type = context.getType(unit.unitTypeId);
      if (!type) continue;
      const candidates: number[] = [];

      if (type.paratroopersRange > 0) {
        candidates.push(
          Math.floor(context.distance(unit.x, unit.y, city.x, city.y) / type.paratroopersRange)
        );
      }

      const path = await findMemoizedPath(unit, city);
      if (path.valid) candidates.push(path.estimatedTurns);

      if (unit.transportedBy) {
        const carrier = context.getUnit(unit.transportedBy);
        if (carrier) {
          const carrierPath = await findMemoizedPath(carrier, city);
          if (carrierPath.valid) {
            const canAttackFromTransport =
              type.flags?.includes('Marines') === true ||
              type.rulesetUnitClassFlags?.includes('AttFromNonNative') === true;
            candidates.push(carrierPath.estimatedTurns + (canAttackFromTransport ? 0 : 1));
          }
        }
      }

      if (candidates.length > 0) {
        travelTimes.set(cityThreatTravelKey(unit.id, city.id), Math.min(...candidates));
      }
    }
  }
  return travelTimes;
}

export async function buildAuthoritativeCityDangerAssessments(options: {
  game: GameInstance;
  cities: CityState[];
  friendlyUnits: Unit[];
  threateningUnits: Unit[];
  profile: AIProfile;
}): Promise<Map<string, CityDangerAssessment>> {
  const { game, cities, friendlyUnits, threateningUnits, profile } = options;
  const travelTimes = await buildCityThreatTravelTimes({
    cities,
    threateningUnits,
    getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
    getUnit: unitId => game.unitManager.getUnit(unitId),
    distance: (fromX, fromY, toX, toY) => game.mapManager.getDistance(fromX, fromY, toX, toY),
    findPath: (unit, targetX, targetY) => game.pathfindingManager.findPath(unit, targetX, targetY),
  });
  return new Map(
    cities.map(city => [
      city.id,
      assessCityDanger({
        city,
        friendlyUnits,
        threateningUnits,
        profile,
        getType: unitTypeId => game.unitManager.getUnitType(unitTypeId),
        defenderStrength: unit => game.unitManager.calculateUnitDefenseRating(unit),
        attackerStrength: (enemy, enemyType) => {
          const attack = game.unitManager.calculateUnitAttackRating(enemy);
          const defenseBonus = game.unitManager.calculateCityDefenseBonusAgainst(
            enemy,
            enemyType,
            city.x,
            city.y
          );
          return (attack * 100) / Math.max(1, 100 + defenseBonus);
        },
        travelTurns: enemy => travelTimes.get(cityThreatTravelKey(enemy.id, city.id)),
      }),
    ])
  );
}

export function canUnitOccupyCity(type: UnitType): boolean {
  return (
    type.rulesetUnitClassFlags?.includes('CanOccupyCity') === true &&
    type.flags?.includes('NonMil') !== true
  );
}

function carriesOccupiers(type: UnitType): boolean {
  return (
    (type.transport_capacity ?? 0) > 0 &&
    (type.cargoClasses?.includes('Land') ||
      type.cargoClasses?.includes('Small Land') ||
      (type.cargoClasses?.length ?? 0) === 0)
  );
}

function actsHostile(type: UnitType): boolean {
  return (
    (type.attack ?? type.combat ?? 0) > 0 ||
    type.bombardRate > 0 ||
    type.flags?.includes('Diplomat') === true ||
    type.flags?.includes('Nuclear') === true
  );
}

/**
 * Port of Freeciv's cached city danger model. Attacker vulnerability and the
 * aggregate defender rating are each squared once, preserving the positive
 * feedback used to compare danger with defense. Occupiers contribute urgency
 * even when their direct attack rating is zero.
 *
 * @reference reference/freeciv/ai/default/daimilitary.c:assess_danger_unit
 * @reference reference/freeciv/ai/default/daimilitary.c:assess_danger
 * @reference reference/freeciv/ai/default/daimilitary.c:assess_defense_quadratic
 */
export function assessCityDanger(context: CityDangerPlanningContext): CityDangerAssessment {
  const assessTurns = dangerAssessmentTurns(context.profile);
  const defenders = context.friendlyUnits.filter(
    unit => unit.x === context.city.x && unit.y === context.city.y && !unit.transportedBy
  );
  const linearDefense = defenders.reduce((sum, unit) => {
    const type = context.getType(unit.unitTypeId);
    if (!type || type.flags?.includes('NonMil')) return sum;
    return sum + (context.defenderStrength?.(unit, type) ?? unitDefenseRating(unit, type));
  }, 0);

  let danger = 0;
  let urgency = 0;
  let graveDanger = context.profile.handicaps.has('danger') ? 1 : 0;
  for (const hostile of context.threateningUnits) {
    const type = context.getType(hostile.unitTypeId);
    if (!type || (!actsHostile(type) && !carriesOccupiers(type))) continue;
    const moveTime = context.travelTurns(hostile, context.city);
    if (moveTime === undefined || !Number.isFinite(moveTime) || moveTime > assessTurns) continue;

    const canOccupy = canUnitOccupyCity(type) || carriesOccupiers(type);
    let vulnerability = actsHostile(type)
      ? (context.attackerStrength?.(hostile, type) ?? unitAttackRating(hostile, type))
      : 0;
    if (canOccupy) {
      vulnerability = Math.max(1, vulnerability);
      if (moveTime <= 3) urgency++;
      if (moveTime <= 1) graveDanger++;
    }
    const squared = vulnerability * vulnerability;
    danger += moveTime > 1 ? squared / moveTime : squared;
  }

  if (graveDanger > 0) urgency += graveDanger * 10;
  if (context.profile.handicaps.has('danger') && danger === 0) danger = 1;
  const defense = linearDefense * linearDefense;
  return {
    city: context.city,
    danger,
    urgency,
    graveDanger,
    defense,
    defenseDeficit: Math.max(0, danger - defense),
    assessTurns,
  };
}

/**
 * Freeciv's defensive-building want escalation.
 *
 * @reference reference/freeciv/ai/default/daimilitary.c:dai_reevaluate_building
 */
export function reevaluateDefensiveBuildingWant(
  baseWant: number,
  assessment: Pick<CityDangerAssessment, 'urgency' | 'danger' | 'defense'>
): number {
  if (baseWant === 0 || assessment.danger <= 0) return baseWant;
  let want = Math.max(baseWant, 100 + assessment.urgency);
  if (assessment.urgency > 0 && assessment.danger > assessment.defense * 2) {
    want += 100;
  } else if (assessment.defense > 0 && assessment.danger > assessment.defense) {
    want = Math.max(want, (assessment.danger * 100) / assessment.defense);
  }
  return want;
}
