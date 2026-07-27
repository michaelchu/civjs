/**
 * @reference reference/freeciv/common/traderoutes.c:209-221 can_cities_trade()
 * @reference reference/freeciv/common/traderoutes.c:332-363 trade_base_between_cities()
 */
import { CityTradeRouteService } from '@game/services/CityTradeRouteService';
import type { CityState } from '@game/managers/CityManager';

function city(id: string, playerId: string, x: number, y: number, population: number): CityState {
  return {
    id,
    name: id,
    playerId,
    x,
    y,
    population,
    size: population,
    cityRadius: 2,
    founded: 1,
    turnsToComplete: 0,
    history: 0,
    buildings: [],
    specialists: {} as CityState['specialists'],
    tradeRoutes: [],
    happiness: { happy: 0, content: population, unhappy: 0, angry: 0 },
    worklist: [],
  };
}

describe('CityTradeRouteService', () => {
  const source = city('source', 'p1', 0, 0, 6);
  const partner = city('partner', 'p2', 20, 0, 4);

  beforeEach(() => {
    source.playerId = 'p1';
    partner.playerId = 'p2';
    source.tradeRoutes = [];
    partner.tradeRoutes = [];
  });

  it('uses classic weighted distance and international multipliers', () => {
    const sameContinent = new CityTradeRouteService(
      new Map([
        [source.id, source],
        [partner.id, partner],
      ]),
      3,
      {
        width: 80,
        height: 50,
        getContinentId: () => 1,
        getCurrentTurn: () => 7,
      }
    );
    const intercontinental = new CityTradeRouteService(
      new Map([
        [source.id, source],
        [partner.id, partner],
      ]),
      3,
      {
        width: 80,
        height: 50,
        getContinentId: x => (x === 0 ? 1 : 2),
        getCurrentTurn: () => 7,
      }
    );

    expect(sameContinent.calculateTradeRouteValue(source, partner).totalValue).toBe(4);
    expect(intercontinental.calculateTradeRouteValue(source, partner).totalValue).toBe(8);
  });

  it('creates reciprocal routes with the authoritative turn', async () => {
    const service = new CityTradeRouteService(
      new Map([
        [source.id, source],
        [partner.id, partner],
      ]),
      3,
      {
        width: 80,
        height: 50,
        getContinentId: () => 1,
        getCurrentTurn: () => 7,
      }
    );

    await expect(service.establishTradeRoute(source.id, partner.id, 'p1')).resolves.toBe(true);
    expect(source.tradeRoutes).toEqual([
      expect.objectContaining({ partnerCity: partner.id, value: 4, establishedTurn: 7 }),
    ]);
    expect(partner.tradeRoutes).toEqual([
      expect.objectContaining({ partnerCity: source.id, value: 4, establishedTurn: 7 }),
    ]);
  });

  it('enforces the classic minimum distance only for domestic routes', async () => {
    const nearby = city('nearby', 'p1', 3, 3, 4);
    const foreign = city('foreign', 'p2', 3, 3, 4);
    const cities = new Map([
      [source.id, source],
      [nearby.id, nearby],
      [foreign.id, foreign],
    ]);
    const service = new CityTradeRouteService(cities);

    await expect(service.establishTradeRoute(source.id, nearby.id, 'p1')).resolves.toBe(false);
    await expect(service.establishTradeRoute(source.id, foreign.id, 'p1')).resolves.toBe(true);
  });

  it('recalculates reciprocal revenue when ownership changes', async () => {
    const service = new CityTradeRouteService(
      new Map([
        [source.id, source],
        [partner.id, partner],
      ])
    );
    await service.establishTradeRoute(source.id, partner.id, 'p1');
    expect(source.tradeRoutes[0].value).toBe(4);

    partner.playerId = 'p1';
    service.updateRoutesOnPlayerChange(partner.id);

    expect(source.tradeRoutes[0].value).toBe(2);
    expect(partner.tradeRoutes[0].value).toBe(2);
  });

  it('removes reciprocal routes when a city is destroyed', async () => {
    const service = new CityTradeRouteService(
      new Map([
        [source.id, source],
        [partner.id, partner],
      ])
    );
    await service.establishTradeRoute(source.id, partner.id, 'p1');

    await service.updateTradeRoutesOnCityDestruction(partner.id);

    expect(source.tradeRoutes).toEqual([]);
  });
});
