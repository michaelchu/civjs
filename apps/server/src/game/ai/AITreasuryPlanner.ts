import type { BuildingType, CityState } from '@game/managers/CityManager';
import type { UnitType } from '@game/services/RulesetUnitsService';
import type { AITreasuryGoal } from '@game/ai/AIStateStore';

export interface TreasuryPlan {
  reserve: number;
  rates: { tax: number; luxury: number; science: number };
  rushCityIds: string[];
  sales: Array<{ cityId: string; buildingId: string }>;
  savingsGoal?: AITreasuryGoal;
  celebrationCityIds: string[];
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
  maxRate?: number;
  canRaptureGrow?: boolean;
  awayMode?: boolean;
  celebrateSize?: number;
  existingSavingsGoal?: AITreasuryGoal;
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

function weightedBuildingEffects(
  city: CityState,
  building: BuildingType,
  oceanTiles: number,
  unrest: number
): number {
  const effects = building.effects ?? {};
  const weightedEffects = [
    (effects.foodBonus ?? 0) * ((city.foodPerTurn ?? 0) <= 0 ? 30 : 8),
    (effects.productionBonus ?? 0) * 10,
    (effects.scienceBonus ?? 0) * 8,
    (effects.goldBonus ?? 0) * 8,
    (effects.happinessEffect ?? 0) * (unrest > 0 ? 30 : 8),
    (effects.defenseBonus ?? 0) * 15,
    (effects.oceanFood ?? 0) * oceanTiles * 12,
    (effects.oceanShields ?? 0) * oceanTiles * 12,
    (effects.immediateTechs ?? 0) * 50,
    (effects.techParasitePlayers ?? 0) * 20,
    ((effects.corruptionReduction ?? 0) *
      Math.max(0, city.grossTradePerTurn ?? city.tradePerTurn ?? 0)) /
      10,
  ];
  return weightedEffects.reduce((sum, value) => sum + value, 0);
}

function buildingStrategicValue(city: CityState, building: BuildingType): number {
  const effects = building.effects ?? {};
  const unrest = city.happiness.unhappy + city.happiness.angry;
  const oceanTiles = (city.workableTiles ?? []).filter(tile =>
    ['ocean', 'deep_ocean', 'coast', 'lake'].includes(tile.terrain ?? '')
  ).length;
  const citySize = city.size ?? city.population ?? 0;
  const growthValue =
    (effects.maxCitySize !== undefined && citySize >= effects.maxCitySize - 2 ? 60 : 0) +
    (effects.unlimitedCitySize && citySize >= 10 ? 80 : 0);
  return weightedBuildingEffects(city, building, oceanTiles, unrest) + growthValue;
}

function celebrationCandidates(context: TreasuryPlanningContext, maxRate: number): CityState[] {
  if (!context.canRaptureGrow || context.awayMode) return [];
  return context.cities.filter(city => {
    const size = city.size ?? city.population ?? 0;
    const unhappy = city.happiness.unhappy + city.happiness.angry * 2;
    const potentialLuxuryHappy = Math.floor((Math.max(0, city.tradePerTurn ?? 0) * maxRate) / 200);
    return (
      size >= (context.celebrateSize ?? 3) &&
      (city.foodPerTurn ?? 0) > 0 &&
      city.happiness.angry === 0 &&
      city.happiness.happy + potentialLuxuryHappy > unhappy
    );
  });
}

function planRates(
  context: TreasuryPlanningContext,
  reserve: number
): { rates: TreasuryPlan['rates']; celebrationCityIds: string[] } {
  const unrest = context.cities.reduce(
    (sum, city) => sum + city.happiness.unhappy + city.happiness.angry,
    0
  );
  const maxRate = Math.max(34, Math.min(100, context.maxRate ?? 100));
  const candidates = celebrationCandidates(context, maxRate);
  const celebrate = context.cities.length > 0 && candidates.length * 2 > context.cities.length;
  const desiredLuxury = celebrate
    ? maxRate
    : unrest > 0
      ? Math.min(30, Math.ceil(unrest / 2) * 10)
      : 0;
  const needsTax =
    context.currentGold < reserve ||
    context.netGold < 0 ||
    Boolean(
      context.existingSavingsGoal && context.currentGold < context.existingSavingsGoal.amount
    );
  const tax = Math.min(maxRate, needsTax ? 60 : 30, 100 - desiredLuxury);
  const luxury = Math.min(maxRate, desiredLuxury, 100 - tax);
  const rates = { tax, luxury, science: Math.min(maxRate, 100 - tax - luxury) };
  let remaining = 100 - rates.tax - rates.luxury - rates.science;
  const balancedTax = Math.min(maxRate - rates.tax, remaining);
  rates.tax += balancedTax;
  remaining -= balancedTax;
  const balancedLuxury = Math.min(maxRate - rates.luxury, remaining);
  rates.luxury += balancedLuxury;
  remaining -= balancedLuxury;
  rates.science += remaining;
  return {
    rates,
    celebrationCityIds: celebrate ? candidates.map(city => city.id).sort() : [],
  };
}

function planEmergencySales(context: TreasuryPlanningContext): {
  sales: TreasuryPlan['sales'];
  projectedGold: number;
} {
  const sales: TreasuryPlan['sales'] = [];
  let projectedGold = context.currentGold + context.netGold;
  if (projectedGold >= 0) return { sales, projectedGold };
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
  return { sales, projectedGold };
}

function unitRushValue(context: TreasuryPlanningContext, city: CityState, threat: number): number {
  if (city.productionType !== 'unit' || !city.currentProduction) return 0;
  const unit = context.unitTypes[city.currentProduction];
  let value =
    (unit?.defense ?? unit?.combat ?? 0) * threat * 30 +
    (unit?.attack ?? unit?.combat ?? 0) * (context.atWar ? 15 : 3);
  if (unit?.canFoundCity) value += Math.max(0, 4 - context.cities.length) * 40;
  return value;
}

function buildingRushValue(context: TreasuryPlanningContext, city: CityState): number {
  if (city.productionType !== 'building' || !city.currentProduction) return 0;
  const building = context.buildingTypes[city.currentProduction];
  return building ? buildingStrategicValue(city, building) : 0;
}

function scoreRushCandidate(context: TreasuryPlanningContext, city: CityState) {
  const cost = context.buyCost(city.id);
  if (!cost.canBuy || cost.goldCost <= 0) return { city, want: 0, goldCost: cost.goldCost };
  const threat = context.threat(city);
  let value =
    threat * 100 + unitRushValue(context, city, threat) + buildingRushValue(context, city);
  if ((city.foodPerTurn ?? 0) < 0) value += 80;
  if (context.existingSavingsGoal?.cityId === city.id) value += cost.goldCost * 100;
  return { city, want: value / Math.max(1, cost.goldCost), goldCost: cost.goldCost };
}

function planRush(
  context: TreasuryPlanningContext,
  reserve: number,
  projectedGold: number
): Pick<TreasuryPlan, 'rushCityIds' | 'savingsGoal'> {
  const candidate = context.cities
    .map(city => scoreRushCandidate(context, city))
    .filter(item => item.want > 1)
    .sort((a, b) => b.want - a.want || a.city.id.localeCompare(b.city.id))[0];
  const canRush = Boolean(candidate && projectedGold - candidate.goldCost >= reserve);
  return {
    rushCityIds: canRush && candidate ? [candidate.city.id] : [],
    savingsGoal:
      !canRush && candidate
        ? {
            cityId: candidate.city.id,
            amount: reserve + candidate.goldCost,
            reason: `rush ${candidate.city.currentProduction ?? 'production'}`,
          }
        : undefined,
  };
}

/**
 * Plan reserves, rates, emergency sales, and rush buying.
 *
 * @reference reference/freeciv/ai/default/daihand.c
 * @reference reference/freeciv/ai/default/daicity.c
 */
export function planTreasury(context: TreasuryPlanningContext): TreasuryPlan {
  const reserve = calculateTreasuryReserve(context);
  const ratePlan = planRates(context, reserve);
  const salePlan = planEmergencySales(context);
  const rushPlan = planRush(context, reserve, salePlan.projectedGold);
  return {
    reserve,
    ...ratePlan,
    sales: salePlan.sales,
    ...rushPlan,
  };
}
