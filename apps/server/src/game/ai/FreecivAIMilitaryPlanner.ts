import { amortize } from '@game/ai/FreecivAIPlanner';
import type { CityState } from '@game/managers/CityManager';
import type { Unit } from '@game/managers/UnitManager';
import type { UnitType } from '@game/services/RulesetUnitsService';

const SHIELD_WEIGHTING = 17;
const TRADE_WEIGHTING = 18;

export interface ProjectedCityDefender {
  rating: number;
  cost: number;
  unitTypeId: string;
}

export interface ProjectedCityDefenderContext {
  gameId: string;
  city: CityState;
  attacker: Unit;
  unitTypes: Iterable<UnitType>;
  canBuild: (cityId: string, unitTypeId: string) => boolean;
  rateDefense: (defender: Unit, attacker: Unit) => number;
}

export interface MilitaryObjective {
  kind: 'stack' | 'city';
  x: number;
  y: number;
  targetId: string;
  defender?: Unit;
  want: number;
  travelTurns: number;
  victimCount: number;
  benefit: number;
}

export interface CityInvasionSupport {
  attacks: number;
  occupiers: number;
  attackRating: number;
  buildCost: number;
}

export interface MilitaryPlanningContext {
  attacker: Unit;
  attackerType: UnitType;
  hostileUnits: Unit[];
  hostileCities: CityState[];
  getType: (unitTypeId: string) => UnitType | undefined;
  travelTurns: (targetX: number, targetY: number) => number | undefined;
  isStackProtected: (x: number, y: number) => boolean;
  invasionSupport?: ReadonlyMap<string, CityInvasionSupport>;
  attackerRating?: (unit: Unit, type: UnitType) => number;
  defenderRating?: (attacker: Unit, defender: Unit, defenderType: UnitType) => number;
  projectedDefender?: (city: CityState, attacker: Unit) => ProjectedCityDefender | undefined;
  causesMilitaryUnhappiness?: (attacker: Unit) => boolean;
}

export interface MilitaryCampaignPlanningContext {
  attackers: Array<{ unit: Unit; type: UnitType }>;
  hostileUnits: Unit[];
  hostileCities: CityState[];
  existingCityTargets?: ReadonlyMap<string, string>;
  getType: (unitTypeId: string) => UnitType | undefined;
  travelTurns: (attacker: Unit, targetX: number, targetY: number) => number | undefined;
  isStackProtected: (x: number, y: number) => boolean;
  acceptObjective?: (attacker: Unit, objective: MilitaryObjective) => boolean;
  attackerRating?: (unit: Unit, type: UnitType) => number;
  defenderRating?: (attacker: Unit, defender: Unit, defenderType: UnitType) => number;
  projectedDefender?: (city: CityState, attacker: Unit) => ProjectedCityDefender | undefined;
  causesMilitaryUnhappiness?: (attacker: Unit) => boolean;
}

export interface MilitaryCampaignPlan {
  assignments: Map<string, MilitaryObjective>;
  invasionSupport: Map<string, CityInvasionSupport>;
}

export interface MilitaryTravelPlanningContext {
  attackers: Unit[];
  targets: Array<{ x: number; y: number }>;
  getNeighbors: (x: number, y: number) => Array<{ x: number; y: number }>;
  findPath: (
    unit: Unit,
    targetX: number,
    targetY: number
  ) => Promise<{ valid: boolean; estimatedTurns: number }>;
}

export function militaryTravelKey(unitId: string, x: number, y: number): string {
  return `${unitId}:${x},${y}`;
}

export async function buildMilitaryTravelTimes(
  context: MilitaryTravelPlanningContext
): Promise<Map<string, number>> {
  const times = new Map<string, number>();
  const targets = new Map(
    context.targets.map(target => [`${target.x},${target.y}`, target] as const)
  );
  await Promise.all(
    context.attackers.flatMap(attacker =>
      [...targets.values()].map(async target => {
        const destinations = [target, ...context.getNeighbors(target.x, target.y)];
        const paths = await Promise.all(
          destinations.map(destination => context.findPath(attacker, destination.x, destination.y))
        );
        const validTurns = paths
          .filter(path => path.valid)
          .map(path => Math.max(0, path.estimatedTurns));
        if (validTurns.length > 0) {
          times.set(militaryTravelKey(attacker.id, target.x, target.y), Math.min(...validTurns));
        }
      })
    )
  );
  return times;
}

/**
 * Select the strongest defensive unit a target city could complete before an
 * attacker arrives. Ties prefer the cheaper equivalent.
 *
 * @reference reference/freeciv/ai/default/daimilitary.c:process_attacker_want
 */
export function selectProjectedCityDefender(
  context: ProjectedCityDefenderContext
): ProjectedCityDefender | undefined {
  return [...context.unitTypes]
    .filter(
      type =>
        type.roles?.some(role => role === 'DefendGood' || role === 'DefendOk') &&
        context.canBuild(context.city.id, type.id)
    )
    .map(type => {
      const projected: Unit = {
        id: `projected:${context.city.id}:${type.id}`,
        gameId: context.gameId,
        playerId: context.city.playerId,
        unitTypeId: type.id,
        x: context.city.x,
        y: context.city.y,
        movementLeft: type.movement,
        health: type.hitpoints ?? 100,
        veteranLevel: 0,
        experience: 0,
        fortified: false,
      };
      return {
        rating: context.rateDefense(projected, context.attacker),
        cost: Math.max(1, type.cost),
        unitTypeId: type.id,
      };
    })
    .sort(
      (left, right) =>
        right.rating - left.rating ||
        left.cost - right.cost ||
        left.unitTypeId.localeCompare(right.unitTypeId)
    )[0];
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

function availableAttacks(type: UnitType): number {
  return Math.max(1, type.movement ?? 1);
}

function emptyInvasionSupport(): CityInvasionSupport {
  return { attacks: 0, occupiers: 0, attackRating: 0, buildCost: 0 };
}

function adjustInvasionSupport(
  support: Map<string, CityInvasionSupport>,
  cityId: string,
  unit: Unit,
  type: UnitType,
  direction: 1 | -1,
  rateAttack: (unit: Unit, type: UnitType) => number = attackRating
): void {
  const current = support.get(cityId) ?? emptyInvasionSupport();
  support.set(cityId, {
    attacks: Math.max(0, current.attacks + direction * availableAttacks(type)),
    occupiers: Math.max(0, current.occupiers + direction * (canOccupyCity(type) ? 1 : 0)),
    attackRating: Math.max(0, current.attackRating + direction * rateAttack(unit, type)),
    buildCost: Math.max(0, current.buildCost + direction * Math.max(1, type.cost)),
  });
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

function selectDefender(stack: Unit[], context: MilitaryPlanningContext): Unit | undefined {
  return stack
    .filter(unit => context.getType(unit.unitTypeId))
    .sort((left, right) => {
      const leftType = context.getType(left.unitTypeId)!;
      const rightType = context.getType(right.unitTypeId)!;
      const leftRating =
        context.defenderRating?.(context.attacker, left, leftType) ?? defenseRating(left, leftType);
      const rightRating =
        context.defenderRating?.(context.attacker, right, rightType) ??
        defenseRating(right, rightType);
      return rightRating - leftRating || left.id.localeCompare(right.id);
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
  const defender = selectDefender(stack, context);
  if (!defender) return undefined;
  const defenderType = context.getType(defender.unitTypeId)!;
  const protectedStack = context.isStackProtected(defender.x, defender.y);
  const vulnerableUnits = protectedStack ? [defender] : stack;
  const support = city
    ? (context.invasionSupport?.get(city.id) ?? emptyInvasionSupport())
    : emptyInvasionSupport();
  const reserves = support.attacks - stack.length;
  let benefit = vulnerableUnits.reduce(
    (sum, unit) => sum + Math.max(1, context.getType(unit.unitTypeId)?.cost ?? 1),
    0
  );
  if (city && reserves > 0 && (canOccupyCity(context.attackerType) || support.occupiers > 0)) {
    benefit += (cityWorth(city) * reserves) / 5;
  }
  const attack =
    ((context.attackerRating?.(context.attacker, context.attackerType) ??
      attackRating(context.attacker, context.attackerType)) +
      support.attackRating) **
    2;
  let selectedDefense =
    context.defenderRating?.(context.attacker, defender, defenderType) ??
    defenseRating(defender, defenderType);
  const victimCount = city ? stack.length : vulnerableUnits.length;
  const travelTurns = context.travelTurns(defender.x, defender.y);
  if (travelTurns === undefined || travelTurns > 10) return undefined;
  if (city && travelTurns > 1) {
    const projected = context.projectedDefender?.(city, context.attacker);
    if (projected && projected.rating > selectedDefense) {
      selectedDefense = projected.rating;
      benefit = Math.max(benefit, projected.cost);
    }
  }
  const vulnerability = selectedDefense ** 2;
  const currentCost = Math.max(1, context.attackerType.cost);
  const needsOccupier =
    city && canOccupyCity(context.attackerType) && support.occupiers === 0 && support.attacks > 0;
  const raw =
    (needsOccupier
      ? currentCost * SHIELD_WEIGHTING
      : killDesire(
          benefit,
          attack,
          currentCost + support.buildCost,
          vulnerability,
          victimCount + (city ? 1 : 0)
        )) -
    travelTurns *
      (context.causesMilitaryUnhappiness?.(context.attacker)
        ? SHIELD_WEIGHTING + 2 * TRADE_WEIGHTING
        : SHIELD_WEIGHTING);
  const want = amortize(raw, travelTurns);
  if (want <= 0) return undefined;
  return {
    kind: city ? 'city' : 'stack',
    x: defender.x,
    y: defender.y,
    targetId: city?.id ?? defender.id,
    defender,
    want,
    travelTurns,
    victimCount,
    benefit,
  };
}

function scoreUndefendedCity(
  context: MilitaryPlanningContext,
  city: CityState
): MilitaryObjective | undefined {
  if (!canOccupyCity(context.attackerType)) return undefined;
  const travelTurns = context.travelTurns(city.x, city.y);
  if (travelTurns === undefined || travelTurns > 10) return undefined;
  const support = context.invasionSupport?.get(city.id) ?? emptyInvasionSupport();
  const projected =
    travelTurns > 1 ? context.projectedDefender?.(city, context.attacker) : undefined;
  const benefit = cityWorth(city) + (projected?.cost ?? 0);
  const attack =
    (context.attackerRating?.(context.attacker, context.attackerType) ??
      attackRating(context.attacker, context.attackerType)) ** 2;
  const raw =
    support.occupiers === 0 && support.attacks > 0
      ? Math.max(1, context.attackerType.cost) * SHIELD_WEIGHTING
      : projected
        ? killDesire(
            benefit,
            attack,
            Math.max(1, context.attackerType.cost) + support.buildCost,
            projected.rating ** 2,
            1
          )
        : benefit * SHIELD_WEIGHTING;
  const travelCost =
    travelTurns *
    (context.causesMilitaryUnhappiness?.(context.attacker)
      ? SHIELD_WEIGHTING + 2 * TRADE_WEIGHTING
      : SHIELD_WEIGHTING);
  const want = amortize(raw - travelCost, travelTurns);
  if (want <= 0) return undefined;
  return {
    kind: 'city',
    x: city.x,
    y: city.y,
    targetId: city.id,
    want,
    travelTurns,
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
      left.travelTurns - right.travelTurns ||
      left.targetId.localeCompare(right.targetId)
  );
}

/**
 * Plan a player's attackers as one campaign. Each city tracks the attack
 * capacity, occupiers, combat rating, and shield cost already committed to
 * it. Previous attack destinations seed the calculation, then each unit is
 * removed and reconsidered so it is never counted twice.
 *
 * @reference reference/freeciv/ai/default/daiunit.c:single_invader
 * @reference reference/freeciv/ai/default/daiunit.c:invasion_funct
 * @reference reference/freeciv/ai/default/daiunit.c:find_something_to_kill
 */
export function planMilitaryCampaign(
  context: MilitaryCampaignPlanningContext
): MilitaryCampaignPlan {
  const cityIds = new Set(context.hostileCities.map(city => city.id));
  const support = new Map<string, CityInvasionSupport>();
  const attackers = context.attackers
    .slice()
    .sort((left, right) => left.unit.id.localeCompare(right.unit.id));

  for (const attacker of attackers) {
    const cityId = context.existingCityTargets?.get(attacker.unit.id);
    if (cityId && cityIds.has(cityId)) {
      adjustInvasionSupport(
        support,
        cityId,
        attacker.unit,
        attacker.type,
        1,
        context.attackerRating
      );
    }
  }

  const assignments = new Map<string, MilitaryObjective>();
  for (const attacker of attackers) {
    const previousCityId = context.existingCityTargets?.get(attacker.unit.id);
    if (previousCityId && cityIds.has(previousCityId)) {
      adjustInvasionSupport(
        support,
        previousCityId,
        attacker.unit,
        attacker.type,
        -1,
        context.attackerRating
      );
    }

    const objective = rankMilitaryObjectives({
      attacker: attacker.unit,
      attackerType: attacker.type,
      hostileUnits: context.hostileUnits,
      hostileCities: context.hostileCities,
      getType: context.getType,
      travelTurns: (targetX, targetY) => context.travelTurns(attacker.unit, targetX, targetY),
      isStackProtected: context.isStackProtected,
      invasionSupport: support,
      attackerRating: context.attackerRating,
      defenderRating: context.defenderRating,
      projectedDefender: context.projectedDefender,
      causesMilitaryUnhappiness: context.causesMilitaryUnhappiness,
    }).find(candidate => context.acceptObjective?.(attacker.unit, candidate) ?? true);
    if (!objective) continue;

    assignments.set(attacker.unit.id, objective);
    if (objective.kind === 'city' && cityIds.has(objective.targetId)) {
      adjustInvasionSupport(
        support,
        objective.targetId,
        attacker.unit,
        attacker.type,
        1,
        context.attackerRating
      );
    }
  }

  return { assignments, invasionSupport: support };
}
