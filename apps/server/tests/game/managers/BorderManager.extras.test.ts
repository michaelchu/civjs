import { BorderManager } from '@game/managers/BorderManager';
import { MapManager } from '@game/managers/MapManager';
import { createBaseTile } from '@game/map/TerrainUtils';

describe('BorderManager ruleset-driven extra sources', () => {
  const createManager = () => {
    const mapManager = new MapManager(9, 9, 'extra-border');
    const tiles = Array.from({ length: 9 }, (_, x) =>
      Array.from({ length: 9 }, (_, y) => ({
        ...createBaseTile(x, y),
        terrain: 'grassland' as const,
      }))
    );
    mapManager.setMapData({
      width: 9,
      height: 9,
      tiles,
      startingPositions: [],
      seed: 'extra-border',
      generatedAt: new Date(0),
    });
    const cityManager = { getCityAt: jest.fn() };
    const effectsManager = {
      calculateEffect: jest.fn(() => ({ value: 0, effects: [] })),
    };
    return {
      mapManager,
      manager: new BorderManager(mapManager, cityManager as any, effectsManager as any),
    };
  };

  it('uses the classic Fortress base border_sq value', () => {
    const { manager, mapManager } = createManager();
    mapManager.updateTileProperty(4, 4, 'improvements', ['fortress']);

    manager.synchronizeTileExtras(4, 4, 'player-1', ['fortress'], []);

    expect(manager.isBorderSource(4, 4)).toBe(true);
    expect(manager.getAllBorderSources()).toEqual([
      expect.objectContaining({
        x: 4,
        y: 4,
        playerId: 'player-1',
        extraType: 'fortress',
        radius: 5,
      }),
    ]);
    expect(manager.getTileOwner(6, 4)).toBe('player-1');
    expect(manager.getTileOwner(7, 4)).toBeNull();
  });

  it('does not turn bases without border_sq into territory sources', () => {
    const { manager, mapManager } = createManager();
    mapManager.updateTileProperty(4, 4, 'improvements', ['airbase']);

    manager.synchronizeTileExtras(4, 4, 'player-1', ['airbase'], []);

    expect(manager.isBorderSource(4, 4)).toBe(false);
    expect(manager.getAllBorderSources()).toHaveLength(0);
  });

  it('removes and recalculates territory when a claiming extra is pillaged', () => {
    const { manager, mapManager } = createManager();
    mapManager.updateTileProperty(4, 4, 'improvements', ['fortress']);
    manager.synchronizeTileExtras(4, 4, 'player-1', ['fortress'], []);
    mapManager.updateTileProperty(4, 4, 'improvements', []);

    manager.synchronizeTileExtras(4, 4, 'player-1', [], ['fortress']);

    expect(manager.getAllBorderSources()).toHaveLength(0);
    expect(manager.getTileOwner(4, 4)).toBeNull();
    expect(mapManager.getTile(4, 4)?.owner).toBeUndefined();
  });
});
