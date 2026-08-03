/**
 * A player's first city receives the buildings listed in the ruleset's
 * `options.global_init_buildings`. This is what puts a Palace (and therefore a
 * government center) on the map, so corruption can measure a real distance.
 *
 * @reference reference/freeciv/server/citytools.c:1559-1564 create_city()
 * @reference reference/freeciv/server/citytools.c:1435-1515 city_build_free_buildings()
 * @reference reference/freeciv/server/ruleset/ruleload.c:1005-1049 lookup_building_list()
 */

import { CityManager, type CityState } from '@game/managers/CityManager';
import { EffectsManager } from '@game/managers/EffectsManager';
import { MapManager } from '@game/managers/MapManager';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import type { DatabaseProvider } from '@database/DatabaseProvider';
import { createMockDatabaseProvider } from '../utils/mockDatabaseProvider';

/** Minimal `cities` row shape that CityManager.loadCities() reads back. */
function persistedRowFor(city: CityState): Record<string, unknown> {
  return {
    id: city.id,
    name: city.name,
    x: city.x,
    y: city.y,
    playerId: city.playerId,
    population: city.population,
    foundedTurn: city.founded,
    currentProduction: city.currentProduction,
    food: city.foodStock ?? 0,
    foodPerTurn: city.foodPerTurn ?? 0,
    production: city.productionStock ?? 0,
    productionPerTurn: city.productionPerTurn ?? 0,
    sciencePerTurn: city.sciencePerTurn ?? 0,
    history: city.history,
    buildings: [...city.buildings],
    specialists: city.specialists,
    productionQueue: [],
    happiness: 0,
    defenseStrength: city.defenseStrength ?? 1,
    workedTiles: [],
  };
}

function createReplayDatabaseProvider(row: Record<string, unknown>): DatabaseProvider {
  const provider = createMockDatabaseProvider();
  const db = provider.getDatabase() as any;
  db.where = jest.fn().mockResolvedValue([row]);
  return provider;
}

function createMockMapManager(): MapManager {
  return {
    getMapData: jest.fn().mockReturnValue({
      width: 80,
      height: 50,
      tiles: [],
    }),
    getTile: jest.fn().mockImplementation((x: number, y: number) => ({
      x,
      y,
      terrain: 'grassland',
      resource: null,
      improvement: null,
      city: null,
      units: [],
      isVisible: true,
    })),
    getTileAt: jest.fn().mockImplementation((x: number, y: number) => ({
      x,
      y,
      terrain: 'grassland',
      resource: null,
      improvement: null,
      city: null,
      units: [],
      isVisible: true,
    })),
    isValidPosition: jest.fn().mockReturnValue(true),
  } as unknown as MapManager;
}

async function createCityManager(effectsManager: EffectsManager): Promise<CityManager> {
  const cityManager = new CityManager('test-game-id', createMockDatabaseProvider(), effectsManager);
  cityManager.setPlayerGovernmentProvider(() => 'despotism');
  cityManager.setMapManager(createMockMapManager());
  await cityManager.initialize();
  return cityManager;
}

describe('ruleset global_init_buildings', () => {
  it('resolves configured display names to canonical building ids', () => {
    // @reference reference/freeciv/data/civ2civ3/game.ruleset:60-62
    expect(rulesetLoader.getGlobalInitBuildings('civ2civ3')).toEqual(['palace']);
  });

  it('normalizes quoted, comma separated and empty entries', () => {
    const options = jest.spyOn(rulesetLoader, 'getGameOptions').mockReturnValue({
      global_init_techs: '',
      global_init_buildings: '"Palace", , "Courthouse" ',
    });

    try {
      expect(rulesetLoader.getGlobalInitBuildings('civ2civ3')).toEqual(['palace', 'courthouse']);
    } finally {
      options.mockRestore();
    }
  });

  it('treats an empty configuration as no free buildings', () => {
    const options = jest
      .spyOn(rulesetLoader, 'getGameOptions')
      .mockReturnValue({ global_init_techs: '', global_init_buildings: '' });

    try {
      expect(rulesetLoader.getGlobalInitBuildings('civ2civ3')).toEqual([]);
    } finally {
      options.mockRestore();
    }
  });

  it('rejects a configured building that the ruleset does not define', () => {
    // @reference reference/freeciv/server/ruleset/ruleload.c:1035-1041
    const options = jest
      .spyOn(rulesetLoader, 'getGameOptions')
      .mockReturnValue({ global_init_techs: '', global_init_buildings: 'Ministry of Silly Walks' });

    try {
      expect(() => rulesetLoader.getGlobalInitBuildings('civ2civ3')).toThrow(
        /Ministry of Silly Walks/
      );
    } finally {
      options.mockRestore();
    }
  });
});

describe('CityManager free initial buildings', () => {
  let effectsManager: EffectsManager;
  let cityManager: CityManager;

  beforeEach(async () => {
    effectsManager = new EffectsManager();
    cityManager = await createCityManager(effectsManager);
  });

  it("gives the ruleset's initial buildings to a player's first city", async () => {
    const capital = await cityManager.foundCity(10, 10, 'Capital', 'player-1');

    expect(capital.buildings).toEqual(['palace']);
  });

  it('does not give initial buildings to a later city of the same player', async () => {
    await cityManager.foundCity(10, 10, 'Capital', 'player-1');
    const colony = await cityManager.foundCity(20, 10, 'Colony', 'player-1');

    expect(colony.buildings).toEqual([]);
  });

  it('gives initial buildings to each player independently', async () => {
    await cityManager.foundCity(10, 10, 'Capital', 'player-1');
    const otherCapital = await cityManager.foundCity(30, 30, 'Other Capital', 'player-2');

    expect(otherCapital.buildings).toEqual(['palace']);
  });

  it('withholds initial buildings once the player has ever founded a city', async () => {
    // @reference reference/freeciv/server/citytools.c:1449-1452 PLRF_FIRST_CITY
    const capital = await cityManager.foundCity(10, 10, 'Capital', 'player-1');
    await cityManager.destroyCity(capital.id);

    const replacement = await cityManager.foundCity(40, 40, 'Replacement', 'player-1');

    expect(replacement.buildings).toEqual([]);
  });

  it('lets corruption find the real government center instead of a fallback', async () => {
    const capital = await cityManager.foundCity(10, 10, 'Capital', 'player-1');
    const colony = await cityManager.foundCity(20, 10, 'Colony', 'player-1');

    const playerCities = cityManager.getPlayerCities('player-1').map(city => ({
      id: city.id,
      x: city.x,
      y: city.y,
      buildings: new Set(city.buildings),
    }));

    const capitalDistance = effectsManager.calculateDistanceToGovCenter(
      {
        playerId: 'player-1',
        cityId: capital.id,
        tileX: capital.x,
        tileY: capital.y,
        government: 'despotism',
        cityBuildings: new Set(capital.buildings),
      },
      playerCities
    );
    const colonyDistance = effectsManager.calculateDistanceToGovCenter(
      {
        playerId: 'player-1',
        cityId: colony.id,
        tileX: colony.x,
        tileY: colony.y,
        government: 'despotism',
        cityBuildings: new Set(colony.buildings),
      },
      playerCities
    );

    expect(capitalDistance).toBe(0);
    expect(colonyDistance).toBe(10);
  });

  it('preserves the palace through recovery and does not grant a second one', async () => {
    const capital = await cityManager.foundCity(10, 10, 'Capital', 'player-1');

    const recovered = new CityManager(
      'test-game-id',
      createReplayDatabaseProvider(persistedRowFor(capital)),
      effectsManager
    );
    recovered.setPlayerGovernmentProvider(() => 'despotism');
    recovered.setMapManager(createMockMapManager());
    await recovered.initialize();
    await recovered.loadCities();

    const colony = await recovered.foundCity(20, 10, 'Colony', 'player-1');

    expect(recovered.getCity(capital.id)!.buildings).toEqual(['palace']);
    expect(colony.buildings).toEqual([]);
  });

  it('does not subtract corruption again during a government refresh', async () => {
    const city = await cityManager.foundCity(10, 10, 'Capital', 'player-1');
    jest.spyOn(cityManager, 'calculateCityOutputs').mockImplementation(() => {
      city.tradePerTurn = 15;
      return {
        food: 2,
        shields: 1,
        trade: 15,
        science: 7,
        gold: 8,
        luxury: 0,
        pollution: 0,
      };
    });

    cityManager.refreshCityWithGovernmentEffects(city.id);

    expect(city.tradePerTurn).toBe(15);
  });
});
