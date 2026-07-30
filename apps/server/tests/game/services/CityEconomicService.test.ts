import { EffectsManager } from '@game/managers/EffectsManager';
import { SpecialistType, type CityState } from '@game/managers/CityManager';
import { CityEconomicService } from '@game/services/CityEconomicService';
import { GOLD_UPKEEP_STYLES } from '@game/systems/Economic/constants/EconomicConstants';

function city(overrides: Partial<CityState> = {}): CityState {
  return {
    id: 'city-a',
    name: 'River Gold Coast',
    x: 0,
    y: 0,
    playerId: 'player',
    population: 9,
    size: 9,
    cityRadius: 2,
    founded: 1,
    turnsToComplete: 0,
    history: 0,
    buildings: [],
    specialists: {
      [SpecialistType.SCIENTIST]: 0,
      [SpecialistType.TAX_COLLECTOR]: 0,
      [SpecialistType.ENTERTAINER]: 0,
      [SpecialistType.WORKER]: 0,
      [SpecialistType.ENGINEER]: 0,
      [SpecialistType.MERCHANT]: 0,
    },
    tradeRoutes: [],
    happiness: { happy: 0, content: 9, unhappy: 0, angry: 0 },
    worklist: [],
    tradePerTurn: 5,
    ...overrides,
  };
}

describe('CityEconomicService trade-route accounting', () => {
  const service = new CityEconomicService('game', new EffectsManager());

  it('adds the persisted value of active routes and ignores disrupted routes', () => {
    const result = service.calculateCityEconomicOutput({
      city: city({
        tradeRoutes: [
          {
            sourceCity: 'city-a',
            partnerCity: 'city-b',
            establishedTurn: 3,
            value: 4,
          },
          {
            sourceCity: 'city-a',
            partnerCity: 'city-c',
            establishedTurn: 4,
            value: 7,
            status: 'disrupted',
          },
        ],
      }),
      supportedUnits: [],
      government: 'despotism',
      goldUpkeepStyle: GOLD_UPKEEP_STYLES.NATION,
    });

    expect(result.rawTrade).toBe(9);
  });

  it('does not synthesize direct terrain gold or recurring route gold', () => {
    const subject = city({
      tradeRoutes: [
        {
          sourceCity: 'city-a',
          partnerCity: 'city-b',
          establishedTurn: 3,
          value: 8,
        },
      ],
    });
    const result = service.calculateDetailedEconomicBreakdown({
      city: subject,
      supportedUnits: [],
      government: 'despotism',
      goldUpkeepStyle: GOLD_UPKEEP_STYLES.NATION,
    });

    expect(result.directGold).toBe(0);
    expect(result.goldSources.tradeRoutes).toBe(0);
  });
});
