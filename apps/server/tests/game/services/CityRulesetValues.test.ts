/**
 * @reference reference/freeciv/data/classic/buildings.ruleset
 * @reference reference/freeciv/data/classic/terrain.ruleset
 * @reference reference/freeciv/common/city.c:3132-3134 city_support()
 */
import { CityDataService } from '@game/services/CityDataService';
import { CityTileManagementService } from '@game/services/CityTileManagementService';
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

  it('uses civstyle.food_cost for serialized food surplus', () => {
    const baseCivstyle = rulesetLoader.getCivstyle();
    const result = CityDataService.transformCityForClient(city({ foodPerTurn: -1 }), 'classic', {
      loader: { getCivstyle: () => ({ ...baseCivstyle, food_cost: 3 }) },
      buildings: rulesetBuildingsService,
    });

    expect(result.surplus.food).toBe(-1);
  });

  it('uses the Freeciv population curve and reports present and supported units', () => {
    const result = CityDataService.transformCityForClient(
      city({ population: 2 }),
      'classic',
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
      'classic',
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

    expect(center.outputs).toEqual({ food: 6, shields: 2, trade: 1 });
    expect(service.calculateCityOutputs(cityState.id)).toEqual({
      food: 5,
      shields: 2,
      trade: 1,
    });
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
      food: 1,
      shields: 1,
      trade: 2,
    });
  });

  it('recalculates worked-tile output after an improvement changes the map', () => {
    const cityState = city({ population: 1 });
    const cities = new Map([[cityState.id, cityState]]);
    const map = mapFor('grassland');
    const mapTile = (map.getTile as jest.Mock)();
    mapTile.improvements = [];
    const service = new CityTileManagementService(cities, map, 5);
    service.setPlayerGovernmentProvider(() => 'republic');

    service.initializeWorkableTiles(cityState);
    expect(service.calculateCityOutputs(cityState.id).food).toBe(2);

    mapTile.improvements.push('irrigation');
    expect(service.calculateCityOutputs(cityState.id).food).toBe(3);
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

  it('applies classic Harbor and Offshore Platform ocean bonuses', () => {
    const cityState = city({
      population: 1,
      buildings: ['harbor', 'offshore_platform'],
    });
    const cities = new Map([[cityState.id, cityState]]);
    const service = new CityTileManagementService(cities, mapFor('ocean'), 5);

    service.initializeWorkableTiles(cityState);

    expect(service.calculateCityOutputs(cityState.id)).toEqual({
      food: 2,
      shields: 1,
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

  it('applies celebration and wonder tile effects from the classic ruleset', () => {
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
      food: 2,
      shields: 1,
      trade: 3,
    });
  });
});
