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

  it('does not turn C2C3 bases without border_sq into territory sources', () => {
    const { manager, mapManager } = createManager();
    mapManager.updateTileProperty(4, 4, 'improvements', ['airbase']);

    manager.synchronizeTileExtras(4, 4, 'player-1', ['airbase'], []);

    expect(manager.isBorderSource(4, 4)).toBe(false);
    expect(manager.getAllBorderSources()).toHaveLength(0);
  });
});
