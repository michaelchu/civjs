import type { BuildingType, CityState } from '@game/cities/CityTypes';
import type { Unit } from '@game/units/UnitTypes';
import type { UnitType } from '@game/services/RulesetUnitsService';
import { amortize } from '@game/ai/AIPlanner';

export interface WonderHelperAssignment {
  unit: Unit;
  targetCity: CityState;
}

export interface WonderCoordinationPlan {
  targetCity?: CityState;
  targetBuilding?: BuildingType;
  assignments: WonderHelperAssignment[];
  productionWants: Map<string, Map<string, number>>;
  technologyWants: Map<string, number>;
  releaseHelpers: boolean;
}

interface WonderPlanningContext {
  cities: CityState[];
  units: Unit[];
  unitTypes: Readonly<Record<string, UnitType>>;
  buildingTypes: Readonly<Record<string, BuildingType>>;
  canBuild: (cityId: string, unitTypeId: string) => boolean;
  distance: (fromX: number, fromY: number, toX: number, toY: number) => number;
}

function isWonderHelper(type: UnitType | undefined): boolean {
  return type?.flags?.includes('HelpWonder') === true;
}

function remainingShields(city: CityState, wonder: BuildingType): number {
  return Math.max(0, wonder.cost - (city.productionStock ?? city.shieldStock ?? 0));
}

/**
 * Select one active Great Wonder, route existing helpers, and requisition only
 * enough additional helper shields to finish it. Helpers are released
 * together once those already at the wonder can complete it immediately.
 *
 * @reference reference/freeciv/ai/default/daidomestic.c:dai_choose_help_wonder
 * @reference reference/freeciv/ai/default/daidomestic.c:dai_wonder_city_distance
 * @reference reference/freeciv/ai/default/daiunit.c:dai_caravan_goto
 */
export function planWonderCoordination(context: WonderPlanningContext): WonderCoordinationPlan {
  const targets = context.cities
    .map(city => ({
      city,
      building: city.currentProduction ? context.buildingTypes[city.currentProduction] : undefined,
    }))
    .filter(
      (
        candidate
      ): candidate is {
        city: CityState;
        building: BuildingType;
      } => candidate.building?.genus === 'GreatWonder'
    )
    .sort(
      (left, right) =>
        (right.city.productionStock ?? right.city.shieldStock ?? 0) -
          (left.city.productionStock ?? left.city.shieldStock ?? 0) ||
        left.city.id.localeCompare(right.city.id)
    );
  const target = targets[0];
  if (!target) {
    return {
      assignments: [],
      productionWants: new Map(),
      technologyWants: new Map(),
      releaseHelpers: false,
    };
  }

  const helperTypes = Object.values(context.unitTypes).filter(isWonderHelper);
  const helpers = context.units
    .filter(unit => isWonderHelper(context.unitTypes[unit.unitTypeId]))
    .sort(
      (left, right) =>
        context.distance(left.x, left.y, target.city.x, target.city.y) -
          context.distance(right.x, right.y, target.city.x, target.city.y) ||
        left.id.localeCompare(right.id)
    );
  const assignments = helpers.map(unit => ({ unit, targetCity: target.city }));
  const required = remainingShields(target.city, target.building);
  const deliveredShields = helpers
    .filter(unit => unit.x === target.city.x && unit.y === target.city.y)
    .reduce((sum, unit) => sum + (context.unitTypes[unit.unitTypeId]?.cost ?? 0), 0);
  const committedShields =
    helpers.reduce((sum, unit) => sum + (context.unitTypes[unit.unitTypeId]?.cost ?? 0), 0) +
    context.cities.reduce((sum, city) => {
      const type = city.currentProduction ? context.unitTypes[city.currentProduction] : undefined;
      return sum + (isWonderHelper(type) ? (type?.cost ?? 0) : 0);
    }, 0);
  let missingShields = Math.max(0, required - committedShields);
  const candidates = context.cities
    .filter(city => city.id !== target.city.id)
    .flatMap(city =>
      helperTypes
        .filter(type => context.canBuild(city.id, type.id))
        .map(type => {
          const travelTurns = Math.ceil(
            context.distance(city.x, city.y, target.city.x, target.city.y) /
              Math.max(1, type.movement)
          );
          const buildTurns = Math.ceil(type.cost / Math.max(1, city.productionPerTurn ?? 1));
          return {
            city,
            type,
            want: amortize(required * 2, travelTurns + buildTurns),
          };
        })
    )
    .sort(
      (left, right) =>
        right.want - left.want ||
        left.city.id.localeCompare(right.city.id) ||
        left.type.id.localeCompare(right.type.id)
    );
  const productionWants = new Map<string, Map<string, number>>();
  for (const candidate of candidates) {
    if (missingShields <= 0 || productionWants.has(candidate.city.id)) continue;
    productionWants.set(candidate.city.id, new Map([[candidate.type.id, candidate.want]]));
    missingShields -= candidate.type.cost;
  }

  const technologyWants = new Map<string, number>();
  if (missingShields > 0 && candidates.length === 0) {
    for (const type of helperTypes) {
      if (!type.requiredTech) continue;
      technologyWants.set(
        type.requiredTech,
        Math.max(technologyWants.get(type.requiredTech) ?? 0, required)
      );
    }
  }

  return {
    targetCity: target.city,
    targetBuilding: target.building,
    assignments,
    productionWants,
    technologyWants,
    releaseHelpers: deliveredShields >= required && required > 0,
  };
}
