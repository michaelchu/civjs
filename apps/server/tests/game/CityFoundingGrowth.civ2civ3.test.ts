import { CityManager } from '@game/managers/CityManager';
import { EffectsManager } from '@game/managers/EffectsManager';
import { rulesetBuildingsService } from '@game/services/RulesetBuildingsService';
import { rulesetUnitsService } from '@game/services/RulesetUnitsService';
import { createMockDatabaseProvider } from '../utils/mockDatabaseProvider';

describe('civ2civ3 city founding and growth', () => {
  it('founding a grassland city assigns a worker and creates food surplus for growth', async () => {
    const databaseProvider = createMockDatabaseProvider();
    const effectsManager = new EffectsManager('civ2civ3');
    const mapManager = {
      getMapData: jest.fn().mockReturnValue({
        width: 80,
        height: 50,
        tiles: Array(80 * 50)
          .fill(null)
          .map((_, index) => ({
            x: index % 80,
            y: Math.floor(index / 80),
            terrain: 'grassland',
            resource: null,
            special: null,
            improvement: null,
            city: null,
            units: [],
            isVisible: true,
          })),
      }),
      getTile: jest.fn((x: number, y: number) => ({
        x,
        y,
        terrain: 'grassland',
        resource: null,
        special: null,
        improvement: null,
        city: null,
        units: [],
        isVisible: true,
      })),
      isValidPosition: jest.fn().mockReturnValue(true),
    } as any;
    const cityManager = new CityManager(
      'civ2civ3-growth-test',
      databaseProvider,
      effectsManager,
      {},
      rulesetUnitsService.getUnitTypes('civ2civ3'),
      rulesetBuildingsService.getPlayableBuildingTypes('civ2civ3')
    );

    cityManager.setMapManager(mapManager);
    cityManager.setPlayerGovernmentProvider(() => 'despotism');
    await cityManager.initialize();

    const city = await cityManager.foundCity(10, 10, 'Grassland City', 'player-1');

    expect(city.population).toBe(1);
    expect(city.workableTiles?.filter(tile => tile.isWorked)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ isCenter: true }),
        expect.objectContaining({ isCenter: false }),
      ])
    );
    expect(city.foodPerTurn).toBe(2);

    for (let turn = 1; turn <= 10; turn++) {
      await cityManager.processCityTurn(city.id, turn);
    }

    expect(city.population).toBe(2);
    expect(city.size).toBe(2);
  });

  it('allows a size-one city to queue a population-cost settler', async () => {
    const databaseProvider = createMockDatabaseProvider();
    const effectsManager = new EffectsManager('civ2civ3');
    const mapManager = {
      getMapData: jest.fn().mockReturnValue({ width: 20, height: 20, tiles: [] }),
      getTile: jest.fn((x: number, y: number) => ({ x, y, terrain: 'grassland', units: [] })),
      isValidPosition: jest.fn().mockReturnValue(true),
    } as any;
    const cityManager = new CityManager(
      'civ2civ3-settler-queue-test',
      databaseProvider,
      effectsManager,
      {},
      rulesetUnitsService.getUnitTypes('civ2civ3'),
      rulesetBuildingsService.getPlayableBuildingTypes('civ2civ3')
    );

    cityManager.setMapManager(mapManager);
    cityManager.setPlayerGovernmentProvider(() => 'despotism');
    await cityManager.initialize();
    const city = await cityManager.foundCity(10, 10, 'Settler City', 'player-1');

    await expect(
      cityManager.setCityProduction(city.id, 'unit', 'settlers', 'player-1')
    ).resolves.toBe(true);
    expect(city.currentProduction).toBe('settlers');
  });
});
