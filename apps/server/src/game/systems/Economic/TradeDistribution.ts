/**
 * @module server/game/systems/Economic/TradeDistribution
 * Implements the Trade Distribution game system.
 */
import type { TaxRates } from './types/EconomicTypes';

export interface TradeOutputs {
  gold: number;
  luxury: number;
  science: number;
}

/**
 * Distribute trade using Freeciv's largest-remainder method.
 *
 * Ties are resolved in science, tax, luxury order, matching the output indices
 * passed by add_tax_income().
 *
 * @reference reference/freeciv/common/city.c:2243-2273 add_tax_income()
 * @reference reference/freeciv/utility/distribute.c:34-107 distribute()
 */
export function distributeTrade(trade: number, rates: TaxRates): TradeOutputs {
  const normalizedTrade = Math.max(0, Math.floor(trade));
  const ratios = [rates.science, rates.tax, rates.luxury];
  const allocations = ratios.map(ratio => Math.floor((normalizedTrade * ratio) / 100));
  const remainders = ratios.map(ratio => (normalizedTrade * ratio) % 100);
  let unallocated = normalizedTrade - allocations.reduce((sum, value) => sum + value, 0);

  while (unallocated > 0) {
    let selected = 0;
    for (let index = 1; index < remainders.length; index++) {
      if (
        remainders[index] > remainders[selected] ||
        (remainders[index] === remainders[selected] && allocations[index] < allocations[selected])
      ) {
        selected = index;
      }
    }

    allocations[selected]++;
    remainders[selected] = -1;
    unallocated--;
  }

  return {
    science: allocations[0],
    gold: allocations[1],
    luxury: allocations[2],
  };
}
