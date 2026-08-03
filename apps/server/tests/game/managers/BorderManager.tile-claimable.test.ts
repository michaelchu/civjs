import { BorderManager } from '@game/managers/BorderManager';
import { EffectsManager } from '@game/managers/EffectsManager';
import { MapManager } from '@game/managers/MapManager';
import { TopologyFlag } from '@game/map/MapTopology';
import { createBaseTile } from '@game/map/TerrainUtils';

const SOURCE = { id: 'city-1', x: 2, y: 4, playerId: 'player-1', size: 2, buildings: [] };

function createBorderManager(width: number, height: number, terrain: 'grassland' | 'ocean') {
  const mapManager = new MapManager(width, height, 'tile-claimable');
  const tiles = Array.from({ length: width }, (_, x) =>
    Array.from({ length: height }, (_, y) => ({
      ...createBaseTile(x, y),
      terrain,
    }))
  );
  tiles[SOURCE.x][SOURCE.y].terrain = 'grassland';
  tiles[SOURCE.x][SOURCE.y].cityId = SOURCE.id;
  mapManager.setMapData({
    width,
    height,
    topologyId: TopologyFlag.ISO | TopologyFlag.HEX,
    wrapId: 0,
    tiles,
    startingPositions: [],
    seed: 'tile-claimable',
    generatedAt: new Date(0),
  });

  const cityManager = {
    getCityAt: jest.fn((x: number, y: number) =>
      x === SOURCE.x && y === SOURCE.y ? SOURCE : undefined
    ),
  };
  const borderManager = new BorderManager(
    mapManager,
    cityManager as any,
    new EffectsManager('civ2civ3'),
    { borderCityRadiusSq: 25, borderSizeEffect: 0 }
  );

  return { mapManager, borderManager };
}

describe('BorderManager C2C3 Tile_Claimable integration', () => {
  /**
   * @evidence parity
   * @reference reference/freeciv/server/maphand.c:2086-2104
   * @reference reference/freeciv/data/civ2civ3/effects.ruleset:4626-4665
   * @assertion C2C3 Tile_Claimable lets a city claim connected land, adjacent water, and a small enclosed lake while excluding distant open ocean.
   * @c2c3-surface terrain-visibility
   * @c2c3-surface-scenario normal,boundary
   */
  it('claims connected land, adjacent water, and distant enclosed lakes but rejects open water', () => {
    const lake = createBorderManager(9, 9, 'grassland');
    lake.mapManager.getTile(4, 7)!.terrain = 'lake';
    lake.borderManager.addCityBorderSource(SOURCE);

    // The lake is five hex steps from the source: too far for MaxDistanceSq
    // but an enclosed one-tile ocean region, so C2C3's lake effect claims it.
    expect(lake.borderManager.getTileOwner(4, 7)).toBe(SOURCE.playerId);
    expect(lake.borderManager.getTileOwner(4, 6)).toBe(SOURCE.playerId);

    const ocean = createBorderManager(11, 11, 'ocean');
    ocean.borderManager.addCityBorderSource(SOURCE);

    // Adjacent water is covered by C2C3's MaxDistanceSq = 2 exception.
    expect(ocean.borderManager.getTileOwner(2, 3)).toBe(SOURCE.playerId);
    // An open-ocean tile at the same five-step range is neither a small lake
    // nor a narrow bay and must not compete in border strength.
    expect(ocean.borderManager.getTileOwner(4, 7)).toBeNull();
    expect(ocean.borderManager.getBorderingSources(4, 7)).toEqual([]);
  });
});
