import type { CityState } from '@game/managers/CityManager';
import type { Unit } from '@game/managers/UnitManager';
import { EffectType, OutputType } from '@game/managers/EffectsManager';

export interface GovernmentChoice {
  governmentId: string;
  value: number;
  netGain: number;
  revolutionCost: number;
  reason: string;
}

interface GovernmentPlanningContext {
  currentGovernmentId: string;
  availableGovernmentIds: string[];
  cities: CityState[];
  units: Unit[];
  atWar: boolean;
  effect: (governmentId: string, type: EffectType, outputType?: OutputType) => number;
  expectedRevolutionTurns?: number;
  planningHorizon?: number;
}

function empireOutput(cities: CityState[]): number {
  return cities.reduce(
    (sum, city) =>
      sum +
      Math.max(0, city.foodPerTurn ?? 0) * 3 +
      Math.max(0, city.productionPerTurn ?? 0) * 4 +
      Math.max(0, city.tradePerTurn ?? 0) * 2 +
      Math.max(0, city.goldPerTurn ?? 0) * 2 +
      Math.max(0, city.sciencePerTurn ?? 0) * 3,
    0
  );
}

function governmentValue(
  governmentId: string,
  context: GovernmentPlanningContext,
  baseOutput: number
): number {
  let value = baseOutput;
  for (const outputType of Object.values(OutputType)) {
    value +=
      (baseOutput *
        (context.effect(governmentId, EffectType.OUTPUT_BONUS, outputType) +
          context.effect(governmentId, EffectType.OUTPUT_BONUS_2, outputType))) /
      100;
    value -=
      context.effect(governmentId, EffectType.OUTPUT_WASTE, outputType) * context.cities.length;
    value -=
      (baseOutput * context.effect(governmentId, EffectType.OUTPUT_WASTE_PCT, outputType)) / 100;
  }
  const freeSupport = context.effect(governmentId, EffectType.UNIT_UPKEEP_FREE_PER_CITY);
  value += Math.min(context.units.length, freeSupport * context.cities.length) * 5;
  const unrest = context.cities.reduce(
    (sum, city) => sum + city.happiness.unhappy + city.happiness.angry * 2,
    0
  );
  value += context.effect(governmentId, EffectType.MAKE_HAPPY) * context.cities.length * 8;
  value += context.effect(governmentId, EffectType.MAKE_CONTENT) * context.cities.length * 5;
  value += context.effect(governmentId, EffectType.MARTIAL_LAW_MAX) * unrest * 4;
  if (context.atWar) {
    value -= context.effect(governmentId, EffectType.UNHAPPY_FACTOR) * context.units.length * 3;
    value -=
      context.effect(governmentId, EffectType.REVOLUTION_UNHAPPINESS) * context.cities.length * 5;
  }
  return value;
}

/**
 * Compare legal governments using ruleset effects and only revolt when the
 * discounted long-term gain pays back the expected turns of anarchy.
 *
 * @reference reference/freeciv/ai/default/daidata.c:dai_gov_value
 * @reference reference/freeciv/ai/default/daitools.c:dai_government_change
 */
export function chooseGovernment(context: GovernmentPlanningContext): GovernmentChoice | undefined {
  const baseOutput = empireOutput(context.cities);
  const currentValue = governmentValue(context.currentGovernmentId, context, baseOutput);
  const horizon = context.planningHorizon ?? 20;
  const revolutionTurns = context.expectedRevolutionTurns ?? 3;
  return context.availableGovernmentIds
    .filter(id => id !== 'anarchy' && id !== context.currentGovernmentId)
    .map(governmentId => {
      const value = governmentValue(governmentId, context, baseOutput);
      const revolutionCost = baseOutput * revolutionTurns;
      const netGain = (value - currentValue) * horizon - revolutionCost;
      return {
        governmentId,
        value,
        netGain,
        revolutionCost,
        reason: `effect value ${value.toFixed(1)} vs ${currentValue.toFixed(1)}; anarchy ${revolutionCost.toFixed(1)}`,
      };
    })
    .filter(choice => choice.netGain > 0)
    .sort((a, b) => b.netGain - a.netGain || a.governmentId.localeCompare(b.governmentId))[0];
}
