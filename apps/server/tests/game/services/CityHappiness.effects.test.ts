/**
 * @reference reference/freeciv/common/city.c:2160-2182 player_base_citizen_happiness()
 * @reference reference/freeciv/common/city.c:2507-2536 citizen_base_mood()
 * @reference reference/freeciv/common/city.c:3108-3174 city_support()
 */
import { EffectsManager } from '@game/managers/EffectsManager';
import {
  CityHappinessService,
  SpecialistType,
  type CityState,
} from '@game/services/CityHappinessService';

function city(overrides: Partial<CityState> = {}): CityState {
  return {
    id: 'city-1',
    name: 'Test City',
    x: 0,
    y: 0,
    playerId: 'player-1',
    population: 8,
    size: 8,
    buildings: [],
    specialists: {
      [SpecialistType.SCIENTIST]: 0,
      [SpecialistType.TAX_COLLECTOR]: 0,
      [SpecialistType.ENTERTAINER]: 0,
      [SpecialistType.WORKER]: 0,
      [SpecialistType.ENGINEER]: 0,
      [SpecialistType.MERCHANT]: 0,
    },
    happiness: { happy: 0, content: 0, unhappy: 0, angry: 0 },
    ...overrides,
  };
}

function serviceFor(government: string, techs: string[] = []): CityHappinessService {
  const service = new CityHappinessService(new EffectsManager());
  service.setPlayerGovernmentProvider(() => government);
  service.setPlayerTechsProvider(() => new Set(techs));
  service.setPlayerBuildingsProvider(() => new Set());
  return service;
}

describe('city happiness from loaded effects', () => {
  /**
   * @evidence parity
   * @reference reference/freeciv/common/city.c:2160-2182
   * @reference reference/freeciv/common/city.c:2507-2536
   * @assertion Government-specific City_Unhappy_Size effects change the base content and unhappy citizen split.
   */
  it('uses government-scoped City_Unhappy_Size effects', () => {
    const republic = serviceFor('republic').calculateDetailedHappiness(city());
    const despotism = serviceFor('despotism').calculateDetailedHappiness(city());

    expect(republic.content).toBe(4);
    expect(republic.unhappy).toBe(4);
    expect(despotism.content).toBe(6);
    expect(despotism.unhappy).toBe(2);
  });

  it('activates the Mysticism-gated Temple contentment bonus', () => {
    const temple = city({ buildings: ['temple'] });
    const withoutMysticism = serviceFor('republic').calculateDetailedHappiness(temple);
    const withMysticism = serviceFor('republic', ['mysticism']).calculateDetailedHappiness(temple);

    expect(withoutMysticism.buildingEffect).toBe(1);
    expect(withMysticism.buildingEffect).toBe(2);
    expect(withMysticism.unhappy).toBe(withoutMysticism.unhappy - 1);
  });

  it('uses the government martial-law value and unit cap', () => {
    const monarchy = serviceFor('monarchy').calculateDetailedHappiness(city(), 0, 10);
    const communism = serviceFor('communism').calculateDetailedHappiness(city(), 0, 10);
    const republic = serviceFor('republic').calculateDetailedHappiness(city(), 0, 10);

    expect(monarchy.unitEffect).toBe(3);
    expect(communism.unitEffect).toBe(6);
    expect(republic.unitEffect).toBe(0);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/common/city.c:2149-2182
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:1211-1337
   * @assertion C2C3 reduces base content one city after a Republic reaches its 16-city empire basis, before local happiness effects are applied.
   * @c2c3-surface city-economy
   * @c2c3-surface-scenario normal, boundary
   */
  it('applies C2C3 empire-size content penalties at the source threshold', () => {
    const service = new CityHappinessService(new EffectsManager('civ2civ3'));
    service.setPlayerGovernmentProvider(() => 'republic');
    service.setPlayerTechsProvider(() => new Set());
    service.setPlayerBuildingsProvider(() => new Set());

    service.setPlayerCityCountProvider(() => 16);
    const atBasis = service.calculateDetailedHappiness(city());
    service.setPlayerCityCountProvider(() => 17);
    const onePastBasis = service.calculateDetailedHappiness(city());
    service.setPlayerCityCountProvider(() => 33);
    const secondStep = service.calculateDetailedHappiness(city());

    expect(atBasis).toMatchObject({ content: 4, unhappy: 4 });
    expect(onePastBasis).toMatchObject({ content: 3, unhappy: 5 });
    expect(secondStep).toMatchObject({ content: 2, unhappy: 6 });
  });

  it('uses loaded elvis output and excludes specialists from base mood', () => {
    const entertainerCity = city({
      population: 3,
      size: 3,
      specialists: {
        [SpecialistType.SCIENTIST]: 0,
        [SpecialistType.TAX_COLLECTOR]: 0,
        [SpecialistType.ENTERTAINER]: 1,
        [SpecialistType.WORKER]: 0,
        [SpecialistType.ENGINEER]: 0,
        [SpecialistType.MERCHANT]: 0,
      },
    });

    const result = serviceFor('republic').calculateDetailedHappiness(entertainerCity);

    expect(result.luxuryEffect).toBe(2);
    expect(result.happy).toBe(1);
    expect(result.happy + result.content + result.unhappy).toBe(2);
  });
});
