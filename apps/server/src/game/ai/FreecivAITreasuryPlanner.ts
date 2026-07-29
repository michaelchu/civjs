import type { BuildingType, CityState } from '@game/managers/CityManager';
import type { UnitType } from '@game/services/RulesetUnitsService';
import type { AITreasuryGoal } from '@game/ai/FreecivAIStateStore';

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

function buildingStrategicValue(city: CityState, building: BuildingType): number {
  const effects = building.effects ?? {};
  const unrest = city.happiness.unhappy + city.happiness.angry;
  const oceanTiles = (city.workableTiles ?? []).filter(tile =>
    ['ocean', 'deep_ocean', 'coast', 'lake'].includes(tile.terrain ?? '')
  ).length;
  const citySize = city.size ?? city.population ?? 0;
  return (
    (effects.foodBonus ?? 0) * ((city.foodPerTurn ?? 0) <= 0 ? 30 : 8) +
    (effects.productionBonus ?? 0) * 10 +
    (effects.scienceBonus ?? 0) * 8 +
    (effects.goldBonus ?? 0) * 8 +
    (effects.happinessEffect ?? 0) * (unrest > 0 ? 30 : 8) +
    (effects.defenseBonus ?? 0) * 15 +
    (effects.oceanFood ?? 0) * oceanTiles * 12 +
    (effects.oceanShields ?? 0) * oceanTiles * 12 +
    (effects.immediateTechs ?? 0) * 50 +
    (effects.techParasitePlayers ?? 0) * 20 +
    ((effects.corruptionReduction ?? 0) *
      Math.max(0, city.grossTradePerTurn ?? city.tradePerTurn ?? 0)) /
      10 +
    (effects.maxCitySize !== undefined && citySize >= effects.maxCitySize - 2 ? 60 : 0) +
    (effects.unlimitedCitySize && citySize >= 10 ? 80 : 0)
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
  const maxRate = Math.max(34, Math.min(100, context.maxRate ?? 100));
  const ordinaryLuxury = unrest > 0 ? Math.min(30, Math.ceil(unrest / 2) * 10) : 0;
  const desiredTax =
    context.currentGold < reserve ||
    context.netGold < 0 ||
    (context.existingSavingsGoal && context.currentGold < context.existingSavingsGoal.amount)
      ? 60
      : 30;
  const celebrationCandidates =
    context.canRaptureGrow && !context.awayMode
      ? context.cities.filter(city => {
          const size = city.size ?? city.population ?? 0;
          const unhappy = city.happiness.unhappy + city.happiness.angry * 2;
          const potentialLuxuryHappy = Math.floor(
            (Math.max(0, city.tradePerTurn ?? 0) * maxRate) / 200
          );
          return (
            size >= (context.celebrateSize ?? 3) &&
            (city.foodPerTurn ?? 0) > 0 &&
            city.happiness.angry === 0 &&
            city.happiness.happy + potentialLuxuryHappy > unhappy
          );
        })
      : [];
  const celebrate =
    context.cities.length > 0 && celebrationCandidates.length * 2 > context.cities.length;
  const desiredLuxury = celebrate ? maxRate : ordinaryLuxury;
  const tax = Math.min(maxRate, desiredTax, 100 - desiredLuxury);
  const luxury = Math.min(maxRate, desiredLuxury, 100 - tax);
  let science = Math.min(maxRate, 100 - tax - luxury);
  let remaining = 100 - tax - luxury - science;
  const balancedTax = Math.min(maxRate - tax, remaining);
  const rates = {
    tax: tax + balancedTax,
    luxury,
    science,
  };
  remaining -= balancedTax;
  if (remaining > 0) {
    const balancedLuxury = Math.min(maxRate - rates.luxury, remaining);
    rates.luxury += balancedLuxury;
    remaining -= balancedLuxury;
  }
  science = rates.science;
  if (remaining > 0) rates.science = science + remaining;

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

  const rushCandidate = context.cities
    .map(city => {
      const cost = context.buyCost(city.id);
      if (!cost.canBuy || cost.goldCost <= 0) return { city, want: 0, goldCost: cost.goldCost };
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
      if (context.existingSavingsGoal?.cityId === city.id) value += cost.goldCost * 100;
      return { city, want: value / Math.max(1, cost.goldCost), goldCost: cost.goldCost };
    })
    .filter(candidate => candidate.want > 1)
    .sort((a, b) => b.want - a.want || a.city.id.localeCompare(b.city.id))[0];
  const canRush = Boolean(rushCandidate && projectedGold - rushCandidate.goldCost >= reserve);
  const rushCityIds = canRush && rushCandidate ? [rushCandidate.city.id] : [];
  const savingsGoal =
    !canRush && rushCandidate
      ? {
          cityId: rushCandidate.city.id,
          amount: reserve + rushCandidate.goldCost,
          reason: `rush ${rushCandidate.city.currentProduction ?? 'production'}`,
        }
      : undefined;

  return {
    reserve,
    rates,
    rushCityIds,
    sales,
    savingsGoal,
    celebrationCityIds: celebrate ? celebrationCandidates.map(city => city.id).sort() : [],
  };
}
