/**
 * @reference reference/freeciv/data/civ2civ3/buildings.ruleset
 * @reference reference/freeciv/data/civ2civ3/terrain.ruleset
 * @reference reference/freeciv/common/city.c:3132-3134 city_support()
 */
import { CityDataService } from '@game/services/CityDataService';
import { CityTileManagementService } from '@game/services/CityTileManagementService';
import { EffectsManager, EffectType, OutputType } from '@game/managers/EffectsManager';
import { rulesetBuildingsService } from '@game/services/RulesetBuildingsService';
import { rulesetLoader } from '@shared/data/rulesets/RulesetLoader';
import type { CityState } from '@game/managers/CityManager';
import type { MapManager } from '@game/managers/MapManager';

function city(overrides: Partial<CityState> = {}): CityState {
  return {
    id: 'city-1',
    name: 'Test City',
    x: 5,
    y: 5,
    playerId: 'player-1',
    population: 2,
    size: 2,
    cityRadius: 2,
    founded: 1,
    currentProduction: null,
    productionType: null,
    turnsToComplete: 0,
    productionStock: 0,
    foodStock: 0,
    foodPerTurn: 5,
    productionPerTurn: 1,
    tradePerTurn: 0,
    sciencePerTurn: 0,
    history: 0,
    buildings: [],
    specialists: {} as CityState['specialists'],
    tradeRoutes: [],
    happiness: { happy: 0, content: 2, unhappy: 0, angry: 0 },
    worklist: [],
    defenseStrength: 1,
    ...overrides,
  };
}

function mapFor(terrain: string, resource: string | null = null): MapManager {
  return {
    getMapData: jest.fn().mockReturnValue({ width: 20, height: 20, tiles: [] }),
    isValidPosition: jest.fn((x: number, y: number) => x === 5 && y === 5),
    getTile: jest.fn().mockReturnValue({
      x: 5,
      y: 5,
      terrain,
      resource,
      improvement: null,
      city: null,
      units: [],
      isVisible: true,
    }),
  } as unknown as MapManager;
}

describe('ruleset-backed city values', () => {
  it('uses C2C3 city-center minimums', () => {
    const service = new CityTileManagementService(
      new Map(),
      mapFor('grassland'),
      5,
      rulesetLoader,
      new EffectsManager('civ2civ3')
    );

    expect((service as any).applyCityCenterMinimums({ food: 0, shields: 0, trade: 0 })).toEqual({
      food: 0,
      shields: 0,
      trade: 0,
    });
  });

  it('serializes building names and upkeep from the building ruleset', () => {
    const result = CityDataService.transformCityForClient(
      city({ buildings: ['marketplace', 'city_walls'] })
    );

    expect(result.buildings).toEqual([
      { id: 'marketplace', name: 'Marketplace', upkeep: 0, sellable: true },
      { id: 'city_walls', name: 'City Walls', upkeep: 0, sellable: true },
    ]);
    expect(rulesetBuildingsService.getBuildingTypes().cathedral.upkeep).toBe(3);
  });

  it('serializes the canonical name for active production targets', () => {
    const result = CityDataService.transformCityForClient(
      city({ currentProduction: 'city_walls', productionType: 'building' })
    );

    expect(result.production?.target).toBe('city_walls');
    expect(result.production?.name).toBe('City Walls');
  });

  it('uses civstyle.food_cost for serialized food surplus', () => {
    const baseCivstyle = rulesetLoader.getCivstyle();
    const result = CityDataService.transformCityForClient(city({ foodPerTurn: -1 }), 'civ2civ3', {
      loader: { getCivstyle: () => ({ ...baseCivstyle, food_cost: 3 }) },
      buildings: rulesetBuildingsService,
    });

    expect(result.surplus.food).toBe(-1);
  });

  it('uses the Freeciv population curve and reports present and supported units', () => {
    const result = CityDataService.transformCityForClient(
      city({ population: 2 }),
      'civ2civ3',
      undefined,
      undefined,
      [
        { id: 'present', x: 5, y: 5 },
        { id: 'supported', x: 8, y: 8, homeCityId: 'city-1' },
        { id: 'other', x: 8, y: 8, homeCityId: 'city-2' },
      ],
      'player-1'
    );

    expect(result.actualPopulation).toBe(30_000);
    expect(result.presentUnits).toEqual(['present']);
    expect(result.supportedUnits).toEqual(['supported']);

    const foreignView = CityDataService.transformCityForClient(
      city({ population: 2 }),
      'civ2civ3',
      undefined,
      undefined,
      [{ id: 'supported', x: 8, y: 8, homeCityId: 'city-1' }],
      'player-2'
    );
    expect(foreignView.supportedUnits).toEqual([]);
    expect(foreignView.workableTiles).toEqual([]);
  });

  it('uses ruleset-backed terrain and resource yields', () => {
    const cityState = city({ population: 1 });
    const cities = new Map([[cityState.id, cityState]]);
    const baseCivstyle = rulesetLoader.getCivstyle();
    const service = new CityTileManagementService(cities, mapFor('grassland', 'wheat'), 5, {
      getTerrain: () => ({
        name: 'grassland',
        graphic: 'grassland',
        properties: {},
        moveCost: 1,
        defense: 10,
        food: 4,
        shields: 2,
        trade: 1,
        roadTime: 2,
        irrigationFoodIncr: 1,
        irrigationTime: 5,
        miningShieldIncr: 0,
        miningTime: 0,
        cultivateTime: 0,
        plantTime: 0,
      }),
      getCivstyle: () => ({ ...baseCivstyle, food_cost: 3 }),
      getResource: () => ({ food: 2 }),
    });

    service.initializeWorkableTiles(cityState);
    const center = cityState.workableTiles!.find(tile => tile.isCenter)!;

    expect(center.outputs).toEqual({ food: 7, shields: 3, trade: 1 });
    expect(service.calculateCityOutputs(cityState.id)).toEqual({
      food: 7,
      shields: 3,
      trade: 1,
    });
  });

  it('preserves string-form terrain flags for tile requirements', () => {
    const cityState = city({ population: 1 });
    const cities = new Map([[cityState.id, cityState]]);
    const map = mapFor('grassland');
    const effects = {
      getRulesetName: () => 'civ2civ3',
      calculateEffect: jest.fn(
        (
          type: EffectType,
          context: { outputType?: OutputType; tileTerrainFlags?: Set<string> }
        ) => ({
          value:
            type === EffectType.TILE_WORKABLE
              ? 1
              : context.outputType === OutputType.FOOD &&
                  context.tileTerrainFlags?.has('CanHaveRiver')
                ? 1
                : 0,
        })
      ),
    } as any;
    const service = new CityTileManagementService(
      cities,
      map,
      5,
      {
        getTerrain: () => ({
          name: 'grassland',
          graphic: 'grassland',
          properties: {},
          flags: 'CanHaveRiver',
          moveCost: 1,
          defense: 10,
          food: 2,
          shields: 0,
          trade: 0,
          roadTime: 2,
          irrigationFoodIncr: 0,
          irrigationTime: 5,
          miningShieldIncr: 0,
          miningTime: 0,
          cultivateTime: 0,
          plantTime: 0,
        }),
        getCivstyle: () => rulesetLoader.getCivstyle(),
      },
      effects
    );

    service.initializeWorkableTiles(cityState);

    expect(service.calculateCityOutputs(cityState.id).food).toBe(3);
  });

  it('applies road, river, and railroad output bonuses', () => {
    const cityState = city({ population: 1 });
    const cities = new Map([[cityState.id, cityState]]);
    const map = mapFor('plains');
    const mapTile = (map.getTile as jest.Mock)();
    mapTile.improvements = ['road', 'railroad'];
    mapTile.hasRoad = true;
    mapTile.hasRailroad = true;
    mapTile.riverMask = 1;
    const service = new CityTileManagementService(cities, map, 5);

    service.initializeWorkableTiles(cityState);

    expect(service.calculateCityOutputs(cityState.id)).toEqual({
      food: 2,
      shields: 2,
      trade: 2,
    });
  });

  it.each(['desert', 'tundra'])('applies the ruleset road trade bonus on %s', terrain => {
    const cityState = city({ population: 1 });
    const cities = new Map([[cityState.id, cityState]]);
    const map = mapFor(terrain);
    const mapTile = (map.getTile as jest.Mock)();
    mapTile.improvements = ['road'];
    mapTile.hasRoad = true;
    const service = new CityTileManagementService(cities, map, 5, {
      getTerrain: (terrainName: string) => rulesetLoader.getTerrain(terrainName, 'civ2civ3'),
      getCivstyle: () => rulesetLoader.getCivstyle('civ2civ3'),
    });

    service.initializeWorkableTiles(cityState);

    expect(service.calculateCityOutputs(cityState.id).trade).toBe(1);
  });

  it('adds the road increment without multiplying a resource trade yield', () => {
    const cityState = city({ population: 1 });
    const cities = new Map([[cityState.id, cityState]]);
    const map = mapFor('tundra', 'furs');
    const mapTile = (map.getTile as jest.Mock)();
    mapTile.improvements = ['road'];
    mapTile.hasRoad = true;
    const service = new CityTileManagementService(
      cities,
      map,
      5,
      {
        getTerrain: (terrainName: string) => rulesetLoader.getTerrain(terrainName, 'civ2civ3'),
        getCivstyle: () => rulesetLoader.getCivstyle('civ2civ3'),
        getResource: (resourceName: string) => rulesetLoader.getResource(resourceName, 'civ2civ3'),
      },
      new EffectsManager('civ2civ3')
    );

    service.initializeWorkableTiles(cityState);

    // Furs contributes 3 trade and the tundra road contributes one fixed trade.
    expect(service.calculateCityOutputs(cityState.id).trade).toBe(4);
  });

  it('keeps the C2C3 city center irrigated when an Irrigation extra is added', () => {
    const cityState = city({ population: 1 });
    const cities = new Map([[cityState.id, cityState]]);
    const map = mapFor('grassland');
    const mapTile = (map.getTile as jest.Mock)();
    mapTile.improvements = [];
    const service = new CityTileManagementService(cities, map, 5);
    service.setPlayerGovernmentProvider(() => 'republic');

    service.initializeWorkableTiles(cityState);
    expect(service.calculateCityOutputs(cityState.id).food).toBe(3);

    mapTile.improvements.push('irrigation');
    expect(service.calculateCityOutputs(cityState.id).food).toBe(3);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/common/city.c:1308-1329
   * @reference reference/freeciv/common/city.c:1334-1371
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:3890-3939
   * @assertion A C2C3 desert city center on a river receives its automatic irrigation and Nile-flood effects, yielding two food from the center tile before city consumption.
   * @c2c3-surface city-economy
   * @c2c3-surface-scenario normal
   */
  it('applies C2C3 irrigation percentages and river-center bonuses in city output', () => {
    const cityState = city({ population: 1 });
    const cities = new Map([[cityState.id, cityState]]);
    const map = mapFor('desert');
    const mapTile = (map.getTile as jest.Mock)();
    mapTile.riverMask = 1;
    const service = new CityTileManagementService(
      cities,
      map,
      5,
      rulesetLoader,
      new EffectsManager('civ2civ3')
    );

    service.initializeWorkableTiles(cityState);

    expect(service.calculateCityOutputs(cityState.id)).toEqual({
      food: 2,
      shields: 2,
      trade: 1,
    });
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/common/city.c:1308-1329
   * @reference reference/freeciv/common/city.c:1334-1371
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:2831-2857
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:3941-3974
   * @assertion On a C2C3 grassland center, Supermarket's automatic-farmland percentage is applied before Pollution's output punishment; a four-food center becomes two food.
   * @c2c3-surface city-economy
   * @c2c3-surface-scenario boundary
   */
  it('orders C2C3 Supermarket and pollution tile effects like Freeciv', () => {
    const cityState = city({ population: 1, buildings: ['supermarket'] });
    const cities = new Map([[cityState.id, cityState]]);
    const map = mapFor('grassland');
    const mapTile = (map.getTile as jest.Mock)();
    mapTile.improvements = ['pollution'];
    const service = new CityTileManagementService(
      cities,
      map,
      5,
      rulesetLoader,
      new EffectsManager('civ2civ3')
    );

    service.initializeWorkableTiles(cityState);

    expect(service.calculateCityOutputs(cityState.id)).toEqual({
      food: 2,
      shields: 1,
      trade: 0,
    });
  });

  it('uses mining percentages for C2C3 Mine extras rather than a hard-coded tile bonus', () => {
    const cityState = city({ population: 1 });
    const cities = new Map([[cityState.id, cityState]]);
    const map = mapFor('hills');
    const mapTile = (map.getTile as jest.Mock)();
    mapTile.improvements = ['mine'];
    const service = new CityTileManagementService(
      cities,
      map,
      5,
      rulesetLoader,
      new EffectsManager('civ2civ3')
    );

    service.initializeWorkableTiles(cityState);

    expect(service.calculateCityOutputs(cityState.id)).toEqual({
      food: 1,
      shields: 4,
      trade: 0,
    });
  });

  it('does not offer C2C3 Inaccessible terrain as a workable tile', async () => {
    const cityState = city({ population: 1 });
    const cities = new Map([[cityState.id, cityState]]);
    const map = {
      getMapData: jest.fn().mockReturnValue({ width: 20, height: 20, tiles: [] }),
      isValidPosition: jest.fn(
        (x: number, y: number) => (x === 5 && y === 5) || (x === 6 && y === 5)
      ),
      getTile: jest.fn((x: number, y: number) => ({
        x,
        y,
        terrain: x === 6 && y === 5 ? 'inaccessible' : 'grassland',
        improvements: [],
        units: [],
      })),
    } as unknown as MapManager;
    const service = new CityTileManagementService(
      cities,
      map,
      5,
      rulesetLoader,
      new EffectsManager('civ2civ3')
    );

    service.initializeWorkableTiles(cityState);

    expect(cityState.workableTiles).toEqual(
      expect.arrayContaining([expect.objectContaining({ x: 6, y: 5, isBlocked: true })])
    );
    await expect(service.assignCitizenToTile(cityState.id, 6, 5)).resolves.toBe(false);
  });

  it('prevents two cities from working the same map tile', async () => {
    const first = city({
      id: 'first',
      workableTiles: [
        {
          x: 6,
          y: 5,
          isWorked: true,
          outputs: { food: 2, shields: 0, trade: 0 },
        },
      ],
    });
    const second = city({
      id: 'second',
      workableTiles: [
        {
          x: 6,
          y: 5,
          isWorked: false,
          outputs: { food: 2, shields: 0, trade: 0 },
        },
      ],
    });
    const cities = new Map([
      [first.id, first],
      [second.id, second],
    ]);
    const service = new CityTileManagementService(cities, mapFor('grassland'), 5);

    await expect(service.assignCitizenToTile(second.id, 6, 5)).resolves.toBe(false);
  });

  it('applies C2C3 Harbor and Offshore Platform ocean bonuses', () => {
    const cityState = city({
      population: 1,
      buildings: ['harbor', 'offshore_platform'],
    });
    const cities = new Map([[cityState.id, cityState]]);
    const service = new CityTileManagementService(cities, mapFor('ocean'), 5);

    service.initializeWorkableTiles(cityState);

    expect(service.calculateCityOutputs(cityState.id)).toEqual({
      food: 1,
      shields: 2,
      trade: 2,
    });
  });

  it('applies the Republic per-tile trade bonus', () => {
    const cityState = city({ population: 1 });
    const cities = new Map([[cityState.id, cityState]]);
    const map = mapFor('grassland');
    const mapTile = (map.getTile as jest.Mock)();
    mapTile.hasRoad = true;
    mapTile.improvements = ['road'];
    const service = new CityTileManagementService(cities, map, 5);
    service.setPlayerGovernmentProvider(() => 'republic');

    service.initializeWorkableTiles(cityState);

    expect(service.calculateCityOutputs(cityState.id).trade).toBe(2);
  });

  it('applies C2C3 celebration and wonder tile effects', () => {
    const cityState = city({
      population: 3,
      wasHappy: true,
      happiness: { happy: 2, content: 1, unhappy: 0, angry: 0 },
      buildings: ['colossus', 'king_richards_crusade'],
    });
    const cities = new Map([[cityState.id, cityState]]);
    const map = mapFor('grassland');
    const mapTile = (map.getTile as jest.Mock)();
    mapTile.hasRoad = true;
    mapTile.improvements = ['road'];
    const service = new CityTileManagementService(cities, map, 5);
    service.setPlayerGovernmentProvider(() => 'monarchy');

    service.initializeWorkableTiles(cityState);

    expect(service.calculateCityOutputs(cityState.id)).toEqual({
      food: 3,
      shields: 1,
      trade: 3,
    });
  });
});
