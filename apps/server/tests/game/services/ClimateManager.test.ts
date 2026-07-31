import { ClimateManager } from '@game/services/ClimateManager';
import { createMockDatabaseProvider } from '../../utils/mockDatabaseProvider';

describe('ClimateManager', () => {
  it('accumulates pollution, persists pressure, and applies a warming transformation', async () => {
    const databaseProvider = createMockDatabaseProvider();
    const tile = {
      x: 1,
      y: 1,
      terrain: 'grassland',
      improvements: ['pollution'],
    };
    const mapData = {
      width: 1,
      height: 1,
      tiles: [[tile]],
    };
    const mapManager = {
      getMapData: jest.fn(() => mapData),
      updateTileProperty: jest.fn((x: number, y: number, property: string, value: unknown) => {
        if (x === tile.x && y === tile.y) (tile as any)[property] = value;
      }),
    };
    const database = databaseProvider.getDatabase() as any;
    database.query.games.findFirst.mockResolvedValue({
      gameState: { climate: { warmingPressure: ClimateManager.EVENT_THRESHOLD - 1 } },
    });
    const manager = new ClimateManager('game-1', mapManager as any, databaseProvider);
    await manager.processTurn();

    expect(tile.terrain).toBe('swamp');
    expect(tile.improvements).not.toContain('pollution');
    expect(database.update).toHaveBeenCalled();
    expect(mapManager.updateTileProperty).toHaveBeenCalledWith(1, 1, 'terrain', 'swamp');
  });

  it('tracks fallout separately for cooling transformations', async () => {
    const databaseProvider = createMockDatabaseProvider();
    const tile = { x: 1, y: 1, terrain: 'grassland', improvements: ['fallout'] };
    const mapData = { width: 1, height: 1, tiles: [[tile]] };
    const mapManager = {
      getMapData: jest.fn(() => mapData),
      updateTileProperty: jest.fn(),
    };
    const database = databaseProvider.getDatabase() as any;
    database.query.games.findFirst.mockResolvedValue({
      gameState: { climate: { coolingPressure: ClimateManager.EVENT_THRESHOLD - 1 } },
    });
    const manager = new ClimateManager('game-1', mapManager as any, databaseProvider);
    await manager.processTurn();

    expect(tile.terrain).toBe('tundra');
    expect(tile.improvements).not.toContain('fallout');
  });

  it('honors disabled climate settings without transforming the map', async () => {
    const databaseProvider = createMockDatabaseProvider();
    const tile = { x: 1, y: 1, terrain: 'grassland', improvements: ['pollution'] };
    const mapData = { width: 1, height: 1, tiles: [[tile]] };
    const mapManager = {
      getMapData: jest.fn(() => mapData),
      updateTileProperty: jest.fn(),
    };
    const database = databaseProvider.getDatabase() as any;
    database.query.games.findFirst.mockResolvedValue({
      gameState: { climate: { warmingPressure: ClimateManager.EVENT_THRESHOLD - 1 } },
    });

    const result = await new ClimateManager(
      'game-1',
      mapManager as any,
      databaseProvider,
      'civ2civ3',
      { enabled: false }
    ).processTurn();

    expect(result.warmingApplied).toBe(false);
    expect(tile.terrain).toBe('grassland');
    expect(mapManager.updateTileProperty).not.toHaveBeenCalled();
  });

  it('uses configured pressure thresholds', async () => {
    const databaseProvider = createMockDatabaseProvider();
    const tile = { x: 1, y: 1, terrain: 'grassland', improvements: ['pollution'] };
    const mapData = { width: 1, height: 1, tiles: [[tile]] };
    const mapManager = {
      getMapData: jest.fn(() => mapData),
      updateTileProperty: jest.fn(),
    };
    const database = databaseProvider.getDatabase() as any;
    database.query.games.findFirst.mockResolvedValue({ gameState: { climate: {} } });

    const result = await new ClimateManager(
      'game-1',
      mapManager as any,
      databaseProvider,
      'civ2civ3',
      { warmingThreshold: 1 }
    ).processTurn();

    expect(result.warmingApplied).toBe(true);
    expect(result.state.warmingPressure).toBe(0);
  });

  it('uses map-scaled probability and escalates the reference warming level', async () => {
    const databaseProvider = createMockDatabaseProvider();
    const tiles = Array.from({ length: 40 }, (_, index) => ({
      x: index,
      y: 0,
      terrain: 'grassland',
      improvements: index === 0 ? ['pollution'] : [],
    }));
    const mapData = { width: 40, height: 1, tiles: [tiles] };
    const mapManager = {
      getMapData: jest.fn(() => mapData),
      updateTileProperty: jest.fn(),
    };
    const database = databaseProvider.getDatabase() as any;
    database.query.games.findFirst.mockResolvedValue({
      gameState: { climate: { warmingPressure: 1 } },
    });
    const noEvent = await new ClimateManager(
      'game-1',
      mapManager as any,
      databaseProvider,
      'civ2civ3',
      {},
      undefined,
      undefined,
      () => 0.999
    ).processTurn();

    expect(noEvent.warmingApplied).toBe(false);
    expect(noEvent.state.warmingPressure).toBe(1);
    expect(noEvent.state.warmingLevel).toBe(1);

    database.query.games.findFirst.mockResolvedValue({
      gameState: { climate: { warmingPressure: 1, warmingLevel: 1 } },
    });
    const event = await new ClimateManager(
      'game-1',
      mapManager as any,
      databaseProvider,
      'civ2civ3',
      {},
      undefined,
      undefined,
      () => 0
    ).processTurn();

    expect(event.warmingApplied).toBe(true);
    expect(event.state.warmingPressure).toBe(0);
    expect(event.state.warmingLevel).toBe(2);
    expect(event.state.warmingEvents).toBe(1);
  });
});
