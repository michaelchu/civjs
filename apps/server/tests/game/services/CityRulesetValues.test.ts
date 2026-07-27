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
      city({ buildings: ['marketplace', 'walls'] })
    );

    expect(result.buildings).toEqual([
      { id: 'marketplace', name: 'Marketplace', upkeep: 0 },
      { id: 'walls', name: 'City Walls', upkeep: 0 },
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

  it('uses injected terrain yields while preserving resource modifiers', () => {
    const cityState = city({ population: 1 });
    const cities = new Map([[cityState.id, cityState]]);
    const baseCivstyle = rulesetLoader.getCivstyle();
    const service = new CityTileManagementService(cities, mapFor('grassland', 'wheat'), 5, {
      getTerrain: () => ({
        name: 'grassland',
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
      }),
      getCivstyle: () => ({ ...baseCivstyle, food_cost: 3 }),
    });

    service.initializeWorkableTiles(cityState);
    const center = cityState.workableTiles!.find(tile => tile.isCenter)!;

    expect(center.outputs).toEqual({ food: 5, shields: 2, trade: 1 });
    expect(service.calculateCityOutputs(cityState.id)).toEqual({
      food: 5,
      shields: 2,
      trade: 1,
    });
  });

  it('recalculates worked-tile output after an improvement changes the map', () => {
    const cityState = city({ population: 1 });
    const cities = new Map([[cityState.id, cityState]]);
    const map = mapFor('grassland');
    const mapTile = (map.getTile as jest.Mock)();
    mapTile.improvements = [];
    const service = new CityTileManagementService(cities, map, 5);

    service.initializeWorkableTiles(cityState);
    expect(service.calculateCityOutputs(cityState.id).food).toBe(2);

    mapTile.improvements.push('irrigation');
    expect(service.calculateCityOutputs(cityState.id).food).toBe(3);
  });
});
