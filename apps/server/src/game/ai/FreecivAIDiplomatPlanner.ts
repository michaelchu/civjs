import { ActionType } from '@app-types/shared/actions';
import type { CityState } from '@game/managers/CityManager';
import type { Unit } from '@game/managers/UnitManager';
import type { UnitType } from '@game/services/RulesetUnitsService';

export interface DiplomatActionOdds {
  successChance: number;
  escapeChance: number;
}

export interface DiplomaticTargetRelation {
  allied: boolean;
  atWar: boolean;
  hasEmbassy: boolean;
}

export interface DiplomatMission {
  unit: Unit;
  kind: 'action' | 'defend' | 'hold';
  action?: ActionType;
  targetId: string;
  targetX: number;
  targetY: number;
  want: number;
}

export interface DiplomatPlanningContext {
  diplomats: Unit[];
  friendlyUnits: Unit[];
  foreignUnits: Unit[];
  foreignCities: CityState[];
  friendlyCities: CityState[];
  getType: (unitTypeId: string) => UnitType | undefined;
  distance: (fromX: number, fromY: number, toX: number, toY: number) => number;
  travelCost: (unit: Unit, targetX: number, targetY: number) => number;
  relation: (playerId: string) => DiplomaticTargetRelation;
  countStealableTechs: (playerId: string) => number;
  inciteCost: (city: CityState) => number;
  bribeCost: (unit: Unit) => number;
  canBribeUnit: (unit: Unit) => boolean;
  canInciteCity: (city: CityState) => boolean;
  actionOdds: (unit: Unit, action: ActionType, defender?: Unit) => DiplomatActionOdds;
  cityUrgency: (city: CityState) => number;
  cityDiplomatThreat: (city: CityState) => boolean;
  cityDiplomatDefender: (city: CityState) => Unit | undefined;
  unitThreatensDiplomat: (foreignUnit: Unit, diplomat: Unit, travelCost: number) => boolean;
  gold: number;
  goldReserve: number;
  diplomatHandicap?: boolean;
  noBribeWarFooting?: boolean;
}

export interface VirtualDiplomatProductionContext {
  playerId: string;
  city: CityState;
  unitTypes: Iterable<UnitType>;
  friendlyUnits: Unit[];
  foreignCities: CityState[];
  canBuild: (unitTypeId: string) => boolean;
  travelTurns: (unitType: UnitType, city: CityState) => number;
  relation: DiplomatPlanningContext['relation'];
  countStealableTechs: DiplomatPlanningContext['countStealableTechs'];
  inciteCost: DiplomatPlanningContext['inciteCost'];
  canInciteCity: DiplomatPlanningContext['canInciteCity'];
  actionOdds: (unitType: UnitType, action: ActionType) => DiplomatActionOdds;
  cityDiplomatThreat: boolean;
  cityUrgency: number;
  conventionalDefenderCount: number;
  gold: number;
  goldReserve: number;
  diplomatHandicap?: boolean;
}

const CITY_ACTION_VALUE: Readonly<Partial<Record<ActionType, number>>> = {
  [ActionType.ESTABLISH_EMBASSY]: 10_000,
  [ActionType.STEAL_TECH]: 9_000,
  [ActionType.INCITE_CITY]: 7_000,
  [ActionType.SABOTAGE_CITY]: 6_000,
  [ActionType.POISON_WATER]: 2_000,
  [ActionType.INVESTIGATE_CITY]: 1,
};

function isDiplomat(type: UnitType | undefined): boolean {
  return Boolean(type?.flags?.includes('Diplomat'));
}

function isSpy(type: UnitType | undefined): boolean {
  return Boolean(type?.flags?.includes('Spy'));
}

function expectedActionUtility(
  action: ActionType,
  actorCost: number,
  odds: DiplomatActionOdds,
  extraValue = 0
): number {
  const success = Math.max(0, Math.min(1, odds.successChance));
  const escape = Math.max(0, Math.min(1, odds.escapeChance));
  const actionValue = (CITY_ACTION_VALUE[action] ?? 0) + extraValue;
  return success * actionValue - (1 - success * escape) * actorCost;
}

function cityActions(
  diplomat: Unit,
  type: UnitType,
  city: CityState,
  context: DiplomatPlanningContext
): Array<{ action: ActionType; utility: number }> {
  const relation = context.relation(city.playerId);
  const actions: ActionType[] = [];
  if (!relation.hasEmbassy) actions.push(ActionType.ESTABLISH_EMBASSY);
  if (!relation.allied && context.countStealableTechs(city.playerId) > 0) {
    actions.push(ActionType.STEAL_TECH);
  }
  if (
    !relation.allied &&
    context.canInciteCity(city) &&
    !city.buildings.includes('palace') &&
    context.inciteCost(city) <= Math.max(0, context.gold - context.goldReserve)
  ) {
    actions.push(ActionType.INCITE_CITY);
  }
  if (relation.atWar && isSpy(type) && city.buildings.some(building => building !== 'palace')) {
    actions.push(ActionType.SABOTAGE_CITY);
  }
  if (relation.atWar && isSpy(type) && city.size >= 2) actions.push(ActionType.POISON_WATER);
  actions.push(ActionType.INVESTIGATE_CITY);
  return actions
    .map(action => ({
      action,
      utility: expectedActionUtility(
        action,
        Math.max(1, type.cost),
        context.actionOdds(diplomat, action, context.cityDiplomatDefender(city))
      ),
    }))
    .filter(candidate => candidate.utility > 0)
    .sort((left, right) => right.utility - left.utility || left.action.localeCompare(right.action));
}

function nearbyUnitMission(
  diplomat: Unit,
  type: UnitType,
  context: DiplomatPlanningContext,
  reservedTargets: ReadonlySet<string>
): DiplomatMission | undefined {
  return context.foreignUnits
    .filter(target => {
      const targetType = context.getType(target.unitTypeId);
      const travel = context.travelCost(diplomat, target.x, target.y);
      return (
        !reservedTargets.has(target.id) &&
        !target.transportedBy &&
        Number.isFinite(travel) &&
        travel <= diplomat.movementLeft &&
        context.relation(target.playerId).allied === false &&
        (!context.noBribeWarFooting ||
          (!targetType?.canFoundCity && !targetType?.canBuildImprovements))
      );
    })
    .flatMap(target => {
      const targetType = context.getType(target.unitTypeId);
      if (!targetType) return [];
      const travel = context.travelCost(diplomat, target.x, target.y);
      const threat = context.unitThreatensDiplomat(target, diplomat, travel);
      const cost = context.bribeCost(target);
      const budget = threat ? context.gold : Math.max(0, context.gold - context.goldReserve);
      if (context.canBribeUnit(target) && cost <= budget) {
        const utility = expectedActionUtility(
          ActionType.BRIBE_UNIT,
          Math.max(1, type.cost),
          context.actionOdds(diplomat, ActionType.BRIBE_UNIT, target),
          Math.max(1, targetType.cost) * 3 - cost
        );
        return utility > 0
          ? [
              {
                unit: diplomat,
                kind: 'action' as const,
                action: ActionType.BRIBE_UNIT,
                targetId: target.id,
                targetX: target.x,
                targetY: target.y,
                want: utility / (travel + 1),
              },
            ]
          : [];
      }
      if (threat && isSpy(type) && context.relation(target.playerId).atWar) {
        const utility = expectedActionUtility(
          ActionType.SABOTAGE_UNIT,
          Math.max(1, type.cost),
          context.actionOdds(diplomat, ActionType.SABOTAGE_UNIT, target),
          Math.max(1, targetType.cost) * 2
        );
        return utility > 0
          ? [
              {
                unit: diplomat,
                kind: 'action' as const,
                action: ActionType.SABOTAGE_UNIT,
                targetId: target.id,
                targetX: target.x,
                targetY: target.y,
                want: utility / (travel + 1),
              },
            ]
          : [];
      }
      return [];
    })
    .sort(
      (left, right) => right.want - left.want || left.targetId.localeCompare(right.targetId)
    )[0];
}

function defensiveMission(
  diplomat: Unit,
  context: DiplomatPlanningContext,
  reservedTargets: ReadonlySet<string>
): DiplomatMission | undefined {
  return context.friendlyCities
    .filter(city => !reservedTargets.has(city.id))
    .map(city => {
      const travel = context.travelCost(diplomat, city.x, city.y);
      const otherDiplomats = context.friendlyUnits.filter(
        unit =>
          unit.id !== diplomat.id &&
          unit.x === city.x &&
          unit.y === city.y &&
          isDiplomat(context.getType(unit.unitTypeId))
      ).length;
      let urgency = context.cityUrgency(city);
      if (otherDiplomats === 0 && context.cityDiplomatThreat(city)) urgency = (urgency + 1) * 5;
      else if (otherDiplomats > 0) urgency /= 3;
      if (travel > 30) urgency /= Math.max(1, travel / 30);
      return { city, travel, want: urgency };
    })
    .filter(candidate => Number.isFinite(candidate.travel) && candidate.want > 0)
    .sort(
      (left, right) =>
        right.want - left.want ||
        left.travel - right.travel ||
        left.city.id.localeCompare(right.city.id)
    )
    .map(({ city, want }) => ({
      unit: diplomat,
      kind: 'defend' as const,
      targetId: city.id,
      targetX: city.x,
      targetY: city.y,
      want,
    }))[0];
}

function virtualInciteGain(
  context: VirtualDiplomatProductionContext,
  city: CityState,
  allied: boolean
): { action: ActionType; value: number } | undefined {
  const incite = context.inciteCost(city);
  if (
    allied ||
    !context.canInciteCity(city) ||
    city.buildings.includes('palace') ||
    incite > Math.max(0, context.gold - context.goldReserve)
  ) {
    return undefined;
  }
  const output =
    Math.max(0, city.foodPerTurn ?? 0) * 10 +
    Math.max(0, city.productionPerTurn ?? 0) * 20 +
    (Math.max(0, city.goldPerTurn ?? 0) +
      Math.max(0, city.sciencePerTurn ?? 0) +
      Math.max(0, city.tradePerTurn ?? 0)) *
      10;
  return { action: ActionType.INCITE_CITY, value: output * 20 - incite * 10 };
}

function virtualDiplomatTargetWant(
  context: VirtualDiplomatProductionContext,
  type: UnitType,
  city: CityState
): number | undefined {
  const relation = context.relation(city.playerId);
  if (relation.allied && relation.hasEmbassy) return undefined;
  const turns = context.travelTurns(type, city);
  if (!Number.isFinite(turns)) return undefined;
  const gains: Array<{ action: ActionType; value: number }> = [];
  if (!relation.hasEmbassy) {
    gains.push({ action: ActionType.ESTABLISH_EMBASSY, value: 99 });
  }
  if (!relation.allied && context.countStealableTechs(city.playerId) > 0) {
    gains.push({
      action: ActionType.STEAL_TECH,
      value: Math.max(1, city.sciencePerTurn ?? city.tradePerTurn ?? city.size) * 90,
    });
  }
  const inciteGain = virtualInciteGain(context, city, relation.allied);
  if (inciteGain) gains.push(inciteGain);
  const best = gains.sort((a, b) => b.value - a.value)[0];
  if (!best || best.value <= 0) return undefined;
  const odds = context.actionOdds(type, best.action);
  const expected =
    odds.successChance * best.value -
    (1 - odds.successChance * odds.escapeChance) * Math.max(1, type.cost);
  const travelPenalty = Math.max(1, turns) * Math.max(1, turns + 1) * 5;
  const want = (expected - travelPenalty) / (1 + Math.max(1, turns) + Math.max(1, type.cost) / 10);
  if (want <= 0) return undefined;
  return Math.max(best.action === ActionType.ESTABLISH_EMBASSY ? 99 : 0, want);
}

/**
 * Port of classic diplomat management: nearby bribery, threatened-city
 * defense, city mission selection, and idle defensive reassignment.
 *
 * @reference reference/freeciv/ai/default/daidiplomat.c
 * @reference reference/freeciv/ai/default/daiactions.c
 */
export function planDiplomatMissions(context: DiplomatPlanningContext): DiplomatMission[] {
  if (context.diplomatHandicap) return [];
  const missions: DiplomatMission[] = [];
  const reservedTargets = new Set<string>();

  for (const diplomat of [...context.diplomats].sort((a, b) => a.id.localeCompare(b.id))) {
    const type = context.getType(diplomat.unitTypeId);
    if (!isDiplomat(type) || diplomat.transportedBy || diplomat.movementLeft <= 0) continue;

    const nearby = nearbyUnitMission(diplomat, type!, context, reservedTargets);
    if (nearby) {
      missions.push(nearby);
      reservedTargets.add(nearby.targetId);
      continue;
    }

    const currentCity = context.friendlyCities.find(
      city => city.x === diplomat.x && city.y === diplomat.y
    );
    const diplomatsHere = context.friendlyUnits.filter(
      unit =>
        unit.x === diplomat.x &&
        unit.y === diplomat.y &&
        isDiplomat(context.getType(unit.unitTypeId))
    ).length;
    if (
      currentCity &&
      diplomatsHere === 1 &&
      (context.cityDiplomatThreat(currentCity) || context.cityUrgency(currentCity) > 0)
    ) {
      missions.push({
        unit: diplomat,
        kind: 'hold',
        targetId: currentCity.id,
        targetX: currentCity.x,
        targetY: currentCity.y,
        want: Infinity,
      });
      reservedTargets.add(currentCity.id);
      continue;
    }

    const offensive = context.foreignCities
      .filter(city => {
        if (reservedTargets.has(city.id)) return false;
        const relation = context.relation(city.playerId);
        if (relation.allied && relation.hasEmbassy) return false;
        return !context.friendlyUnits.some(
          unit =>
            unit.id !== diplomat.id &&
            isDiplomat(context.getType(unit.unitTypeId)) &&
            context.distance(unit.x, unit.y, city.x, city.y) <= 1
        );
      })
      .flatMap(city => {
        const travel = context.travelCost(diplomat, city.x, city.y);
        if (!Number.isFinite(travel)) return [];
        const best = cityActions(diplomat, type!, city, context)[0];
        return best
          ? [{ city, action: best.action, want: best.utility / (travel + 1), travel }]
          : [];
      })
      .sort(
        (left, right) =>
          right.want - left.want ||
          left.travel - right.travel ||
          left.city.id.localeCompare(right.city.id)
      )[0];
    if (offensive) {
      missions.push({
        unit: diplomat,
        kind: 'action',
        action: offensive.action,
        targetId: offensive.city.id,
        targetX: offensive.city.x,
        targetY: offensive.city.y,
        want: offensive.want,
      });
      reservedTargets.add(offensive.city.id);
      continue;
    }

    const defense = defensiveMission(diplomat, context, reservedTargets);
    if (defense) {
      missions.push(defense);
      reservedTargets.add(defense.targetId);
    }
  }
  return missions;
}

/**
 * City-local defensive and offensive diplomat demand.
 *
 * @reference reference/freeciv/ai/default/daidiplomat.c:dai_choose_diplomat_defensive
 * @reference reference/freeciv/ai/default/daidiplomat.c:dai_choose_diplomat_offensive
 */
export function rankVirtualDiplomatProduction(
  context: VirtualDiplomatProductionContext
): Map<string, number> {
  const types = [...context.unitTypes].filter(isDiplomat);
  return new Map(
    types.flatMap(type => {
      if (!context.canBuild(type.id)) return [];
      const hasDiplomat = context.friendlyUnits.some(
        unit =>
          unit.x === context.city.x &&
          unit.y === context.city.y &&
          isDiplomat(types.find(candidate => candidate.id === unit.unitTypeId))
      );
      if (context.conventionalDefenderCount > 0 && context.cityDiplomatThreat && !hasDiplomat) {
        return [[type.id, 16_000] as const];
      }
      if (context.diplomatHandicap) return [];

      const want = context.foreignCities
        .map(city => virtualDiplomatTargetWant(context, type, city))
        .filter((value): value is number => value !== undefined)
        .sort((a, b) => b - a)[0];
      return want !== undefined ? ([[type.id, want]] as const) : [];
    })
  );
}

export function rankDiplomatTechnologyWants(context: {
  unitTypes: Iterable<UnitType>;
  knownTechs: ReadonlySet<string>;
  cityDiplomatThreat: boolean;
  conventionalDefenderCount: number;
  canBuild: (unitTypeId: string) => boolean;
}): Map<string, number> {
  if (!context.cityDiplomatThreat || context.conventionalDefenderCount <= 0) return new Map();
  const diplomatTypes = [...context.unitTypes].filter(isDiplomat);
  if (diplomatTypes.some(type => context.canBuild(type.id))) return new Map();
  const candidate = diplomatTypes.sort(
    (left, right) => left.cost - right.cost || left.id.localeCompare(right.id)
  )[0];
  const wants = new Map<string, number>();
  if (candidate?.requiredTech && !context.knownTechs.has(candidate.requiredTech)) {
    wants.set(candidate.requiredTech, 3_000);
  }
  return wants;
}
