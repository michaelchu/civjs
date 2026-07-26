/**
 * Corruption is a single ruleset-driven calculation applied while city outputs
 * are produced. These tests pin the freeciv `city_waste()` pipeline down to the
 * loaded effect values so a ruleset edit changes the trade a city keeps.
 *
 * @reference reference/freeciv/common/city.c:3253-3337 city_waste()
 * @reference reference/freeciv/common/city.c:2287-2314 nearest_gov_center()
 * @reference reference/freeciv/common/city.c:1587-1590 is_gov_center()
 */

import {
  CityCalculationService,
  type CityPlayerContext,
  type CityState,
} from '@game/services/CityCalculationService';
import { EffectsManager, EffectType } from '@game/managers/EffectsManager';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import type { Effect } from '@shared/data/rulesets/schemas';

const CITY_TILE_OUTPUTS = { food: 2, shields: 1, trade: 20 };

function createCity(overrides: Partial<CityState> & Pick<CityState, 'id' | 'x' | 'y'>): CityState {
  return {
    name: overrides.id,
    playerId: 'player-1',
    population: 1,
    size: 1,
    cityRadius: 2,
    founded: 1,
    turnsToComplete: 0,
    history: 0,
    buildings: [],
    specialists: {},
    tradeRoutes: [],
    happiness: { happy: 0, content: 1, unhappy: 0, angry: 0 },
    worklist: [],
    ...overrides,
  };
}

function createPlayerContext(government: string, playerCities: CityState[]): CityPlayerContext {
  return {
    government,
    playerTechs: new Set<string>(),
    playerBuildings: new Set(playerCities.flatMap(city => city.buildings)),
    playerCities,
  };
}

/**
 * Build an EffectsManager backed by the supplied effect data. The manager
 * caches per instance, so priming it while the loader is stubbed injects the
 * ruleset without mutating the shared RulesetLoader cache.
 */
function createEffectsManagerFrom(effects: Record<string, Effect>): EffectsManager {
  const loaderSpy = jest.spyOn(rulesetLoader, 'getEffects').mockReturnValue(effects);
  try {
    const manager = new EffectsManager();
    manager.calculateEffect(EffectType.OUTPUT_WASTE, {});
    return manager;
  } finally {
    loaderSpy.mockRestore();
  }
}

function tradeFor(
  effectsManager: EffectsManager,
  city: CityState,
  playerContext: CityPlayerContext
): number {
  const service = new CityCalculationService(effectsManager);
  return service.calculateCityOutputs(city, CITY_TILE_OUTPUTS, undefined, playerContext).trade;
}

describe('city corruption from loaded effects', () => {
  let effectsManager: EffectsManager;

  beforeEach(() => {
    effectsManager = new EffectsManager();
  });

  it('treats a Gov_Center city as distance zero', () => {
    // @reference reference/freeciv/common/city.c:2294-2299
    const capital = createCity({ id: 'capital', x: 0, y: 0, buildings: ['palace'] });
    const context = createPlayerContext('republic', [capital]);

    const distance = effectsManager.calculateDistanceToGovCenter(
      {
        playerId: capital.playerId,
        cityId: capital.id,
        tileX: capital.x,
        tileY: capital.y,
        government: 'republic',
        cityBuildings: new Set(capital.buildings),
      },
      [{ id: capital.id, x: capital.x, y: capital.y, buildings: new Set(capital.buildings) }]
    );

    expect(distance).toBe(0);
    // Republic base waste is 3; Palace removes floor(3 * 50 / 100) = 1.
    expect(tradeFor(effectsManager, capital, context)).toBe(18);
  });

  it('measures distance from zero coordinates instead of treating them as missing', () => {
    const capital = createCity({ id: 'capital', x: 0, y: 0, buildings: ['palace'] });
    const colony = createCity({ id: 'colony', x: 0, y: 4 });

    const distance = effectsManager.calculateDistanceToGovCenter(
      {
        playerId: colony.playerId,
        cityId: colony.id,
        tileX: colony.x,
        tileY: colony.y,
        government: 'republic',
        cityBuildings: new Set(colony.buildings),
      },
      [{ id: capital.id, x: capital.x, y: capital.y, buildings: new Set(capital.buildings) }]
    );

    expect(distance).toBe(4);
  });

  it('ignores owned cities without an active Gov_Center effect', () => {
    // @reference reference/freeciv/common/city.c:2300-2310
    const capital = createCity({ id: 'capital', x: 0, y: 0, buildings: ['palace'] });
    const neighbour = createCity({ id: 'neighbour', x: 6, y: 5, buildings: ['temple'] });
    const colony = createCity({ id: 'colony', x: 6, y: 6 });

    const distance = effectsManager.calculateDistanceToGovCenter(
      {
        playerId: colony.playerId,
        cityId: colony.id,
        tileX: colony.x,
        tileY: colony.y,
        government: 'republic',
        cityBuildings: new Set(colony.buildings),
      },
      [capital, neighbour, colony].map(city => ({
        id: city.id,
        x: city.x,
        y: city.y,
        buildings: new Set(city.buildings),
      }))
    );

    // real_map_distance() is MAX(|dx|, |dy|) on the square topology, so the
    // palace six tiles away wins over the adjacent temple city.
    expect(distance).toBe(6);
  });

  it('applies distance corruption to a distant Republic city', () => {
    const capital = createCity({ id: 'capital', x: 0, y: 0, buildings: ['palace'] });
    const colony = createCity({ id: 'colony', x: 5, y: 0 });
    const context = createPlayerContext('republic', [capital, colony]);

    // Republic: base 15% of 20 = 3, plus 200 * 5 / 100 = 10% of 20 = 2.
    expect(tradeFor(effectsManager, colony, context)).toBe(15);
  });

  it('reduces corruption when the city has a Courthouse', () => {
    const capital = createCity({ id: 'capital', x: 0, y: 0, buildings: ['palace'] });
    const colony = createCity({ id: 'colony', x: 5, y: 0 });
    const courthouseColony = createCity({
      id: 'colony',
      x: 5,
      y: 0,
      buildings: ['courthouse'],
    });

    const plainTrade = tradeFor(
      effectsManager,
      colony,
      createPlayerContext('republic', [capital, colony])
    );
    const courthouseTrade = tradeFor(
      effectsManager,
      courthouseColony,
      createPlayerContext('republic', [capital, courthouseColony])
    );

    expect(courthouseTrade).toBeGreaterThan(plainTrade);
    // Courthouse removes floor(5 * 50 / 100) = 2 from the 5 point waste.
    expect(courthouseTrade).toBe(17);
  });

  it('wastes all trade when distance waste is active without a government center', () => {
    // @reference reference/freeciv/common/city.c:3292-3302
    const city = createCity({ id: 'orphan', x: 5, y: 0 });
    const result = effectsManager.calculateCityCorruption(
      {
        playerId: city.playerId,
        cityId: city.id,
        tileX: city.x,
        tileY: city.y,
        government: 'republic',
        cityBuildings: new Set(),
      },
      20,
      [{ id: city.id, x: city.x, y: city.y, buildings: new Set() }]
    );

    expect(result).toEqual({ corruption: 20, distanceToGovCenter: null });
  });

  it('changes trade when the loaded corruption effect value changes', () => {
    const capital = createCity({ id: 'capital', x: 0, y: 0, buildings: ['palace'] });
    const colony = createCity({ id: 'colony', x: 1, y: 0 });
    const context = createPlayerContext('republic', [capital, colony]);

    const govCenter: Effect = {
      id: 'palace_gov_center',
      type: 'Gov_Center',
      value: 1,
      reqs: [{ type: 'Building', name: 'Palace', range: 'City' }],
    };
    const baseWaste = (value: number): Effect => ({
      id: 'corruption_republic_base',
      type: 'Output_Waste',
      value,
      reqs: [
        { type: 'Gov', name: 'republic', range: 'Player' },
        { type: 'OutputType', name: 'Trade', range: 'Local' },
      ],
    });

    const lenient = createEffectsManagerFrom({
      palace_gov_center: govCenter,
      corruption_republic_base: baseWaste(10),
    });
    const punitive = createEffectsManagerFrom({
      palace_gov_center: govCenter,
      corruption_republic_base: baseWaste(50),
    });

    expect(tradeFor(lenient, colony, context)).toBe(18);
    expect(tradeFor(punitive, colony, context)).toBe(10);
  });
});
