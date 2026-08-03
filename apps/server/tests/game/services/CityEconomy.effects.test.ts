/**
 * @reference reference/freeciv/common/city.c:2227-2240
 * @reference reference/freeciv/common/city.c:3013-3037
 * @reference reference/freeciv/common/traderoutes.c:520-555
 */
import type { CityState } from '@game/cities/CityTypes';
import { EffectsManager } from '@game/managers/EffectsManager';
import { CityCalculationService } from '@game/services/CityCalculationService';
import { CityTradeRouteService } from '@game/services/CityTradeRouteService';

function city(overrides: Partial<CityState> = {}): CityState {
  return {
    id: 'city-1',
    name: 'Test City',
    x: 0,
    y: 0,
    playerId: 'player-1',
    population: 4,
    size: 4,
    cityRadius: 2,
    founded: 1,
    currentProduction: null,
    productionType: null,
    turnsToComplete: 0,
    productionStock: 0,
    foodStock: 0,
    foodPerTurn: 0,
    productionPerTurn: 0,
    tradePerTurn: 0,
    sciencePerTurn: 0,
    history: 0,
    buildings: [],
    specialists: {} as CityState['specialists'],
    tradeRoutes: [],
    happiness: { happy: 0, content: 4, unhappy: 0, angry: 0 },
    worklist: [],
    ...overrides,
  };
}

describe('C2C3 city economy effects', () => {
  /**
   * @evidence parity
   * @reference reference/freeciv/common/city.c:2227-2240
   * @reference reference/freeciv/common/city.c:3013-3037
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:1662-1676
   * @assertion Fundamentalism converts one active Temple Make_Content effect into one direct gold before city gold output bonuses, while the same Temple provides no tithes under Republic.
   * @c2c3-surface city-economy
   * @c2c3-surface-scenario normal, boundary
   */
  it('converts active contentment effects to Fundamentalist tithes', () => {
    const effects = new EffectsManager('civ2civ3');
    const calculation = new CityCalculationService(effects);
    const templeCity = city({ buildings: ['temple'] });
    const context = (government: string) => ({
      government,
      playerTechs: new Set<string>(),
      playerBuildings: new Set<string>(),
      playerCities: [templeCity],
      taxRates: { tax: 100, luxury: 0, science: 0 },
    });

    const fundamentalism = calculation.calculateCityOutputs(
      templeCity,
      { food: 8, shields: 0, trade: 0 },
      undefined,
      context('fundamentalism')
    );
    const republic = calculation.calculateCityOutputs(
      templeCity,
      { food: 8, shields: 0, trade: 0 },
      undefined,
      context('republic')
    );

    expect(fundamentalism.gold).toBe(1);
    expect(republic.gold).toBe(0);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/common/traderoutes.c:520-555
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:3706-3725
   * @assertion C2C3's -1000 base, +1585 compatibility adjustment, and Railroad -1000 modifier use Freeciv's upward rounding, scaling a twenty-gold caravan settlement to thirty-one before Railroad and sixteen after it.
   * @c2c3-surface city-economy
   * @c2c3-surface-scenario normal, boundary
   */
  it('applies the C2C3 exponential trade-revenue modifiers', () => {
    const source = city({ id: 'source', x: 0, y: 0, tradePerTurn: 12 });
    const partner = city({ id: 'partner', x: 10, y: 0, tradePerTurn: 12 });
    const researched = new Set<string>();
    const service = new CityTradeRouteService(
      new Map([
        [source.id, source],
        [partner.id, partner],
      ]),
      2,
      {
        width: 40,
        height: 20,
        getContinentId: () => 1,
        getCurrentTurn: () => 1,
      },
      new EffectsManager('civ2civ3')
    );
    service.setPlayerTechsProvider(() => researched);

    expect(service.calculateTradeSettlement(source, partner, 'domestic').bonus).toBe(31);

    researched.add('railroad');
    expect(service.calculateTradeSettlement(source, partner, 'domestic').bonus).toBe(16);
  });
});
