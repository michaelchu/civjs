import { DisasterManager } from '@game/managers/DisasterManager';
import { createMockDatabaseProvider } from '../../utils/mockDatabaseProvider';

describe('DisasterManager classic ruleset execution', () => {
  it('loads all six classic disaster definitions verbatim', () => {
    const config = DisasterManager.createRulesetConfig('classic');

    expect(config.frequency).toBe(10);
    expect(config.definitions.map(definition => definition.id)).toEqual([
      'earthquake',
      'pestilence',
      'fire',
      'industrial_accident',
      'nuclear_accident',
      'robbery',
    ]);
    expect(config.definitions.find(definition => definition.id === 'industrial_accident')).toEqual(
      expect.objectContaining({
        frequency: 10,
        effects: ['ReducePopulation', 'Pollution'],
        requirements: [
          expect.objectContaining({ type: 'Building', name: 'Mfg. Plant', range: 'City' }),
        ],
      })
    );
  });

  it('checks building requirements before applying an industrial accident', async () => {
    const city = {
      id: 'city-1',
      name: 'Rome',
      playerId: 'player-1',
      buildings: [],
      tradePerTurn: 4,
    } as any;
    const cityManager = {
      getPlayerCities: jest.fn(() => [city]),
      reducePopulationForDisaster: jest.fn().mockResolvedValue(true),
      placeDisasterExtra: jest.fn().mockResolvedValue(true),
    } as any;
    const databaseProvider = createMockDatabaseProvider();
    const classic = DisasterManager.createRulesetConfig('classic');
    const config = {
      ...classic,
      definitions: classic.definitions.filter(
        definition => definition.id === 'industrial_accident'
      ),
    };
    const manager = new DisasterManager(
      'game-1',
      config,
      cityManager,
      databaseProvider,
      undefined,
      () => 0
    );

    expect(await manager.checkPlayerDisasters('player-1', 12, -3520)).toEqual([]);
    city.buildings = ['mfg_plant'];

    const [disaster] = await manager.checkPlayerDisasters('player-1', 12, -3520);
    expect(disaster).toEqual(
      expect.objectContaining({
        success: true,
        type: 'industrial_accident',
        effects: [
          expect.objectContaining({ effect: 'ReducePopulation', value: 1 }),
          expect.objectContaining({ effect: 'Pollution', value: 1 }),
        ],
      })
    );
    expect(cityManager.reducePopulationForDisaster).toHaveBeenCalledWith('city-1');
    expect(cityManager.placeDisasterExtra).toHaveBeenCalledWith(
      'city-1',
      'pollution',
      expect.any(Function)
    );
  });

  it('implements classic robbery as five times city trade, capped by treasury', async () => {
    const city = {
      id: 'city-1',
      name: 'Rome',
      playerId: 'player-1',
      buildings: [],
      tradePerTurn: 4,
    } as any;
    const cityManager = { getPlayerCities: jest.fn(() => [city]) } as any;
    const economicManager = {
      getPlayerGold: jest.fn().mockResolvedValue(17),
      spendPlayerGold: jest.fn().mockResolvedValue({ success: true, newBalance: 0 }),
    } as any;
    const manager = new DisasterManager(
      'game-1',
      {
        enabled: true,
        frequency: 10,
        definitions: [
          {
            id: 'robbery',
            name: 'Robbery',
            frequency: 10,
            requirements: [],
            effects: ['Robbery'],
          },
        ],
      },
      cityManager,
      createMockDatabaseProvider(),
      economicManager,
      () => 0
    );

    const [disaster] = await manager.checkPlayerDisasters('player-1');

    expect(disaster.effects).toEqual([expect.objectContaining({ effect: 'Robbery', value: 17 })]);
    expect(economicManager.spendPlayerGold).toHaveBeenCalledWith(
      'player-1',
      17,
      'Robbery in Rome',
      { cityId: 'city-1' }
    );
  });

  it('evaluates terrain, adjacent extras, and minimum city size requirements', async () => {
    const city = {
      id: 'city-1',
      name: 'Rome',
      playerId: 'player-1',
      x: 2,
      y: 2,
      size: 9,
      buildings: [],
    } as any;
    const center = { x: 2, y: 2, terrain: 'grassland', riverMask: 0, improvements: [] };
    const adjacent = { x: 3, y: 2, terrain: 'plains', riverMask: 1, improvements: [] };
    const cityManager = {
      getPlayerCities: jest.fn(() => [city]),
      emptyStock: jest.fn(),
    } as any;
    const mapManager = {
      getTile: jest.fn(() => center),
      getNeighbors: jest.fn(() => [adjacent]),
    } as any;
    const manager = new DisasterManager(
      'game-1',
      {
        enabled: true,
        frequency: 10,
        definitions: [
          {
            id: 'earthquake',
            name: 'Earthquake',
            frequency: 10,
            requirements: [{ type: 'Terrain', name: 'Grassland', range: 'Tile' }],
            effects: [],
          },
          {
            id: 'flood',
            name: 'Flood',
            frequency: 10,
            requirements: [{ type: 'Extra', name: 'River', range: 'Adjacent' }],
            effects: [],
          },
          {
            id: 'fire',
            name: 'Fire',
            frequency: 10,
            requirements: [{ type: 'MinSize', name: '9', range: 'City' }],
            effects: [],
          },
        ],
      },
      cityManager,
      createMockDatabaseProvider(),
      undefined,
      () => 0,
      mapManager,
      'civ2civ3'
    );

    const disasters = await manager.checkPlayerDisasters('player-1');

    expect(disasters.map(disaster => disaster.type)).toEqual(['earthquake', 'flood', 'fire']);
    expect(mapManager.getTile).toHaveBeenCalledWith(2, 2);
    expect(mapManager.getNeighbors).toHaveBeenCalledWith(2, 2);
  });

  it('fails closed when a map-backed requirement has no map context', async () => {
    const city = {
      id: 'city-1',
      name: 'Rome',
      playerId: 'player-1',
      x: 2,
      y: 2,
      size: 9,
      buildings: [],
    } as any;
    const manager = new DisasterManager(
      'game-1',
      {
        enabled: true,
        frequency: 10,
        definitions: [
          {
            id: 'earthquake',
            name: 'Earthquake',
            frequency: 10,
            requirements: [{ type: 'Terrain', name: 'Grassland', range: 'Tile' }],
            effects: [],
          },
        ],
      },
      { getPlayerCities: () => [city] } as any,
      createMockDatabaseProvider(),
      undefined,
      () => 0
    );

    await expect(manager.checkPlayerDisasters('player-1')).resolves.toEqual([]);
  });
});
