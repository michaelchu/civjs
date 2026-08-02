/**
 * @module server/game/ai/AITradePlanner
 * Implements AITrade Planner decision logic for AI-controlled players.
 */
import { ActionType } from '@app-types/shared/actions';
import type { CityState } from '@game/cities/CityTypes';
import type { Unit } from '@game/units/UnitTypes';
import type { UnitType } from '@game/services/RulesetUnitsService';

export interface CaravanAssignment {
  unit: Unit;
  homeCity: CityState;
  targetCity: CityState;
  action: ActionType.TRADE_ROUTE | ActionType.MARKETPLACE;
  value: number;
  requiresTransport: boolean;
}

interface CaravanPlanningContext {
  units: Unit[];
  cities: CityState[];
  getCity: (cityId: string) => CityState | undefined;
  getType: (unitTypeId: string) => UnitType | undefined;
  canTradeWith: (playerId: string) => boolean;
  distance: (fromX: number, fromY: number, toX: number, toY: number) => number;
  continent: (x: number, y: number) => number | undefined;
  tradeValue: (sourceCityId: string, targetCityId: string) => number;
}

function isCaravan(type: UnitType | undefined): boolean {
  return Boolean(type && (type.id === 'caravan' || type.flags?.includes('HelpWonder')));
}

/**
 * Rank legal non-war caravan destinations by the same two durable benefits
 * used by Freeciv's aicore caravan planner: recurring route trade plus the
 * one-time marketplace windfall, discounted by transit time.
 *
 * @reference reference/freeciv/common/aicore/caravan.c
 * @reference reference/freeciv/ai/default/daiunit.c:dai_manage_caravan
 */
export function planCaravanTrade(context: CaravanPlanningContext): CaravanAssignment[] {
  const assignments: CaravanAssignment[] = [];
  for (const unit of context.units.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    const type = context.getType(unit.unitTypeId);
    const home = unit.homeCityId ? context.getCity(unit.homeCityId) : undefined;
    if (!isCaravan(type) || !home || unit.transportedBy) continue;

    const candidates = context.cities
      .filter(city => city.id !== home.id && context.canTradeWith(city.playerId))
      .filter(city => !home.tradeRoutes?.some(route => route.partnerCity === city.id))
      .map(city => {
        const distance = context.distance(unit.x, unit.y, city.x, city.y);
        const arrivalTurns = Math.ceil(distance / Math.max(1, type!.movement));
        const routeValue = context.tradeValue(home.id, city.id);
        const windfall = Math.ceil(
          ((distance + 10) * ((home.tradePerTurn ?? 0) + (city.tradePerTurn ?? 0))) / 24
        );
        const recurringValue = routeValue > 0 ? routeValue / (1 - 0.95) : 0;
        const discountedValue = (recurringValue + windfall) * 0.95 ** arrivalTurns;
        return {
          city,
          routeValue,
          value: discountedValue,
          requiresTransport:
            context.continent(unit.x, unit.y) !== context.continent(city.x, city.y),
        };
      })
      .filter(candidate => candidate.value > 0)
      .sort(
        (left, right) =>
          right.value - left.value ||
          context.distance(unit.x, unit.y, left.city.x, left.city.y) -
            context.distance(unit.x, unit.y, right.city.x, right.city.y) ||
          left.city.id.localeCompare(right.city.id)
      );
    const best = candidates[0];
    if (!best) continue;
    assignments.push({
      unit,
      homeCity: home,
      targetCity: best.city,
      action: best.routeValue > 0 ? ActionType.TRADE_ROUTE : ActionType.MARKETPLACE,
      value: best.value,
      requiresTransport: best.requiresTransport,
    });
  }
  return assignments;
}
