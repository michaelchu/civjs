import type { BuildingType, CityState } from '@game/managers/CityManager';
import type { UnitType } from '@game/services/RulesetUnitsService';

export interface TreasuryPlan {
  reserve: number;
  rates: { tax: number; luxury: number; science: number };
  rushCityIds: string[];
  sales: Array<{ cityId: string; buildingId: string }>;
}

interface TreasuryPlanningContext {
  currentGold: number;
  netGold: number;
  cities: CityState[];
  unitCount: number;
  atWar: boolean;
  unitTypes: Record<string, UnitType>;
  buildingTypes: Record<string, BuildingType>;
  buyCost: (cityId: string) => { canBuy: boolean; goldCost: number };
  threat: (city: CityState) => number;
}

export function calculateTreasuryReserve(
  context: Pick<TreasuryPlanningContext, 'cities' | 'unitCount' | 'atWar' | 'netGold'>
): number {
  return (
    20 +
    context.cities.length * 10 +
    Math.ceil(context.unitCount / 4) * 5 +
    (context.atWar ? 30 : 0) +
    Math.max(0, -context.netGold) * 3
  );
}

function buildingStrategicValue(city: CityState, building: BuildingType): number {
  const effects = building.effects ?? {};
  const unrest = city.happiness.unhappy + city.happiness.angry;
  return (
    (effects.foodBonus ?? 0) * ((city.foodPerTurn ?? 0) <= 0 ? 30 : 8) +
    (effects.productionBonus ?? 0) * 10 +
    (effects.scienceBonus ?? 0) * 8 +
    (effects.goldBonus ?? 0) * 8 +
    (effects.happinessEffect ?? 0) * (unrest > 0 ? 30 : 8) +
    (effects.defenseBonus ?? 0) * 15
  );
}

/**
 * Plan reserves, rates, emergency sales, and rush buying.
 *
 * @reference reference/freeciv/ai/default/daihand.c
 * @reference reference/freeciv/ai/default/daicity.c
 */
export function planTreasury(context: TreasuryPlanningContext): TreasuryPlan {
  const unrest = context.cities.reduce(
    (sum, city) => sum + city.happiness.unhappy + city.happiness.angry,
    0
  );
  const reserve = calculateTreasuryReserve(context);
  const luxury = unrest > 0 ? Math.min(30, Math.ceil(unrest / 2) * 10) : 0;
  const tax = Math.min(
    100 - luxury,
    context.currentGold < reserve || context.netGold < 0 ? 60 : 30
  );
  const rates = { tax, luxury, science: 100 - tax - luxury };

  const sales: Array<{ cityId: string; buildingId: string }> = [];
  let projectedGold = context.currentGold + context.netGold;
  if (projectedGold < 0) {
    const candidates = context.cities
      .flatMap(city =>
        city.buildings.map(buildingId => ({
          city,
          buildingId,
          building: context.buildingTypes[buildingId],
          upkeep:
            (context.buildingTypes[buildingId] as (BuildingType & { upkeep?: number }) | undefined)
              ?.upkeep ?? 0,
        }))
      )
      .filter(
        candidate =>
          candidate.building?.genus === 'Improvement' &&
          candidate.upkeep > 0 &&
          candidate.buildingId !== 'palace'
      )
      .sort((a, b) => {
        const left = a.upkeep * 20 - buildingStrategicValue(a.city, a.building);
        const right = b.upkeep * 20 - buildingStrategicValue(b.city, b.building);
        return right - left || a.buildingId.localeCompare(b.buildingId);
      });
    for (const candidate of candidates) {
      if (projectedGold >= 0) break;
      sales.push({ cityId: candidate.city.id, buildingId: candidate.buildingId });
      projectedGold += candidate.building.cost + candidate.upkeep;
    }
  }

  const rushCityIds =
    projectedGold <= reserve
      ? []
      : context.cities
          .map(city => {
            const cost = context.buyCost(city.id);
            if (!cost.canBuy || cost.goldCost <= 0 || projectedGold - cost.goldCost < reserve) {
              return { city, want: 0, goldCost: cost.goldCost };
            }
            const threat = context.threat(city);
            let value = threat * 100;
            if (city.productionType === 'unit' && city.currentProduction) {
              const unit = context.unitTypes[city.currentProduction];
              value +=
                (unit?.defense ?? unit?.combat ?? 0) * threat * 30 +
                (unit?.attack ?? unit?.combat ?? 0) * (context.atWar ? 15 : 3);
              if (unit?.canFoundCity) value += Math.max(0, 4 - context.cities.length) * 40;
            } else if (city.productionType === 'building' && city.currentProduction) {
              const building = context.buildingTypes[city.currentProduction];
              if (building) value += buildingStrategicValue(city, building);
            }
            if ((city.foodPerTurn ?? 0) < 0) value += 80;
            return { city, want: value / Math.max(1, cost.goldCost), goldCost: cost.goldCost };
          })
          .filter(candidate => candidate.want > 1)
          .sort((a, b) => b.want - a.want || a.city.id.localeCompare(b.city.id))
          .slice(0, 1)
          .map(candidate => candidate.city.id);

  return { reserve, rates, rushCityIds, sales };
}
