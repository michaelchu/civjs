import { distributeTrade } from '@game/systems/Economic/TradeDistribution';
import { TaxRateService } from '@game/systems/Economic/services/TaxRateService';

describe('Freeciv trade distribution', () => {
  it('assigns the remaining trade to the largest fractional share', () => {
    expect(distributeTrade(7, { tax: 50, luxury: 20, science: 30 })).toEqual({
      gold: 4,
      luxury: 1,
      science: 2,
    });
  });

  it('breaks an exact tie by science, tax, luxury order', () => {
    expect(distributeTrade(1, { tax: 50, luxury: 0, science: 50 })).toEqual({
      gold: 0,
      luxury: 0,
      science: 1,
    });
  });

  it('is the shared implementation used by TaxRateService', () => {
    const service = new TaxRateService('game');
    service.initializePlayerTaxRates('player', { tax: 50, luxury: 20, science: 30 });

    expect(service.convertTradeToOutputs('player', 7)).toEqual({
      gold: 4,
      luxury: 1,
      science: 2,
    });
  });
});
