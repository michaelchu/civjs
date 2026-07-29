import { amortize } from '@game/ai/FreecivAIPlanner';
import type { CityState } from '@game/managers/CityManager';
import type { Unit } from '@game/managers/UnitManager';
import type { UnitType } from '@game/services/RulesetUnitsService';

const SHIELD_WEIGHTING = 17;

export interface MilitaryObjective {
  kind: 'stack' | 'city';
  x: number;
  y: number;
  targetId: string;
  defender?: Unit;
  want: number;
  distance: number;
  victimCount: number;
  benefit: number;
}

export interface MilitaryPlanningContext {
  attacker: Unit;
  attackerType: UnitType;
  hostileUnits: Unit[];
  hostileCities: CityState[];
  getType: (unitTypeId: string) => UnitType | undefined;
  distance: (targetX: number, targetY: number) => number;
  isStackProtected: (x: number, y: number) => boolean;
}

export function killDesire(
  benefit: number,
  attack: number,
  loss: number,
  vulnerability: number,
  victimCount: number
): number {
  const denominator = attack + vulnerability * victimCount;
  if (denominator <= 0) return 0;
  return ((benefit * attack - loss * vulnerability) * victimCount * SHIELD_WEIGHTING) / denominator;
}

function attackRating(unit: Unit, type: UnitType): number {
  return (
    Math.max(0, type.attack ?? type.combat ?? 0) *
    Math.max(1, type.firepower ?? 1) *
    Math.max(1, unit.health)
  );
}

function defenseRating(unit: Unit, type: UnitType): number {
  return (
    Math.max(0, type.defense ?? type.combat ?? 0) *
    Math.max(1, type.firepower ?? 1) *
    Math.max(1, unit.health)
  );
}

function canOccupyCity(type: UnitType): boolean {
  return (
    type.rulesetUnitClassFlags?.includes('CanOccupyCity') === true &&
    type.flags?.includes('NonMil') !== true
  );
}

function groupStacks(units: Unit[]): Unit[][] {
  const stacks = new Map<string, Unit[]>();
  for (const unit of units) {
    const key = `${unit.x},${unit.y}`;
    const stack = stacks.get(key) ?? [];
    stack.push(unit);
    stacks.set(key, stack);
  }
  return [...stacks.values()];
}

function selectDefender(
  stack: Unit[],
  getType: MilitaryPlanningContext['getType']
): Unit | undefined {
  return stack
    .filter(unit => getType(unit.unitTypeId))
    .sort((left, right) => {
      const leftType = getType(left.unitTypeId)!;
      const rightType = getType(right.unitTypeId)!;
      return (
        defenseRating(right, rightType) - defenseRating(left, leftType) ||
        left.id.localeCompare(right.id)
      );
    })[0];
}

function cityWorth(city: CityState): number {
  return Math.max(1, city.size) * 10 + city.buildings.length * 5 + 20;
}

function scoreStack(
  context: MilitaryPlanningContext,
  stack: Unit[],
  city?: CityState
): MilitaryObjective | undefined {
  const defender = selectDefender(stack, context.getType);
  if (!defender) return undefined;
  const defenderType = context.getType(defender.unitTypeId)!;
  const protectedStack = context.isStackProtected(defender.x, defender.y);
  const vulnerableUnits = protectedStack ? [defender] : stack;
  const benefit =
    vulnerableUnits.reduce(
      (sum, unit) => sum + Math.max(1, context.getType(unit.unitTypeId)?.cost ?? 1),
      0
    ) + (city && canOccupyCity(context.attackerType) ? cityWorth(city) : 0);
  const attack = attackRating(context.attacker, context.attackerType) ** 2;
  const vulnerability = defenseRating(defender, defenderType) ** 2;
  const victimCount = vulnerableUnits.length;
  const distance = context.distance(defender.x, defender.y);
  if (distance / Math.max(1, context.attackerType.movement) > 10) return undefined;
  const raw =
    killDesire(
      benefit,
      attack,
      Math.max(1, context.attackerType.cost),
      vulnerability,
      victimCount
    ) -
    (distance / Math.max(1, context.attackerType.movement)) * SHIELD_WEIGHTING;
  const want = amortize(raw, distance / Math.max(1, context.attackerType.movement));
  if (want <= 0) return undefined;
  return {
    kind: city ? 'city' : 'stack',
    x: defender.x,
    y: defender.y,
    targetId: city?.id ?? defender.id,
    defender,
    want,
    distance,
    victimCount,
    benefit,
  };
}

function scoreUndefendedCity(
  context: MilitaryPlanningContext,
  city: CityState
): MilitaryObjective | undefined {
  if (!canOccupyCity(context.attackerType)) return undefined;
  const distance = context.distance(city.x, city.y);
  const turns = distance / Math.max(1, context.attackerType.movement);
  if (turns > 10) return undefined;
  const benefit = cityWorth(city);
  const want = amortize(benefit * SHIELD_WEIGHTING - turns * SHIELD_WEIGHTING, turns);
  if (want <= 0) return undefined;
  return {
    kind: 'city',
    x: city.x,
    y: city.y,
    targetId: city.id,
    want,
    distance,
    victimCount: 0,
    benefit,
  };
}

/**
 * Rank hostile field stacks and cities with Freeciv's shield-weighted
 * kill-desire equation. Unprotected field stacks expose the value of every
 * collateral victim; protected stacks expose only the selected defender.
 *
 * @reference reference/freeciv/ai/default/daiunit.c:kill_desire
 * @reference reference/freeciv/ai/default/daitools.c:stack_cost
 * @reference reference/freeciv/ai/default/daiunit.c:find_something_to_kill
 */
export function rankMilitaryObjectives(context: MilitaryPlanningContext): MilitaryObjective[] {
  const cityByTile = new Map(context.hostileCities.map(city => [`${city.x},${city.y}`, city]));
  const objectives: MilitaryObjective[] = [];
  const occupiedCityIds = new Set<string>();

  for (const stack of groupStacks(context.hostileUnits)) {
    const city = cityByTile.get(`${stack[0].x},${stack[0].y}`);
    const objective = scoreStack(context, stack, city);
    if (objective) objectives.push(objective);
    if (city) occupiedCityIds.add(city.id);
  }
  for (const city of context.hostileCities) {
    if (occupiedCityIds.has(city.id)) continue;
    const objective = scoreUndefendedCity(context, city);
    if (objective) objectives.push(objective);
  }

  return objectives.sort(
    (left, right) =>
      right.want - left.want ||
      left.distance - right.distance ||
      left.targetId.localeCompare(right.targetId)
  );
}
