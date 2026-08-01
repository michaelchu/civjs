import { createHash } from 'node:crypto';
import { MapManager, type MapGeneratorType } from '@game/managers/MapManager';
import { PlayerState } from '@game/managers/GameManager';
import { MapStartpos, TemperatureType } from '@game/map/MapTypes';
import { ContinentProcessor } from '@game/map/terrain/ContinentProcessor';
import { createBaseTile, isFrozenTerrain, isLandTile } from '@game/map/TerrainUtils';
import { TopologyFlag, WrapFlag } from '@game/map/MapTopology';
import { StartingPositionGenerator } from '@game/map/StartingPositionGenerator';
import { FreecivScenarioLoader } from '@game/map/FreecivScenarioLoader';
import { HeightBasedMapService } from '@game/map/HeightBasedMapService';
import { MapAccessService } from '@game/map/MapAccessService';
import {
  getMapSqSize,
  getPseudoFractalExtraDivisions,
  getRandomSmoothPasses,
} from '@game/map/MapGenerationUtils';
import { TemperatureMap, getIceBaseLevel } from '@game/map/TemperatureMap';

const players = new Map<string, PlayerState>([
  [
    'player-1',
    {
      id: 'player-1',
      userId: 'user-1',
      playerNumber: 1,
      civilization: 'American',
      isReady: true,
      hasEndedTurn: false,
      isConnected: true,
      lastSeen: new Date(0),
    },
  ],
  [
    'player-2',
    {
      id: 'player-2',
      userId: 'user-2',
      playerNumber: 2,
      civilization: 'Roman',
      isReady: true,
      hasEndedTurn: false,
      isConnected: true,
      lastSeen: new Date(0),
    },
  ],
]);

function digest(manager: MapManager): string {
  const map = manager.getMapData()!;
  return createHash('sha256')
    .update(
      JSON.stringify({
        width: map.width,
        height: map.height,
        topologyId: map.topologyId,
        wrapId: map.wrapId,
        starts: map.startingPositions,
        tiles: map.tiles
          .flat()
          .map(tile => [
            tile.terrain,
            tile.elevation,
            tile.resource,
            tile.riverMask,
            tile.continentId,
          ]),
      })
    )
    .digest('hex');
}

describe('map generation parity contracts', () => {
  it('uses Freeciv map-size and start-position scaling formulas', () => {
    expect(getMapSqSize(40, 25)).toBe(1);
    expect(getMapSqSize(80, 50)).toBe(2);
    expect(getRandomSmoothPasses(40, 25, 4, MapStartpos.DEFAULT)).toBe(2);
    expect(getRandomSmoothPasses(80, 50, 4, MapStartpos.DEFAULT)).toBe(3);
    expect(getRandomSmoothPasses(40, 25, 4, MapStartpos.SINGLE)).toBe(1);
    expect(getPseudoFractalExtraDivisions(4, MapStartpos.DEFAULT)).toBe(1);
    expect(getPseudoFractalExtraDivisions(4, MapStartpos.VARIABLE)).toBe(5);
    expect(getIceBaseLevel(70, 2, true)).toBe(10);
    expect(getIceBaseLevel(70, 2, false)).toBe(20);
  });

  it('calculates symmetric colatitude using the configured wrap topology', () => {
    const earth = new TemperatureMap(80, 50);
    expect(earth.mapColatitude(0, 0)).toBe(0);
    expect(earth.mapColatitude(0, 49)).toBe(0);
    expect(earth.mapColatitude(0, 24)).toBe(earth.mapColatitude(0, 25));

    const sideways = new TemperatureMap(80, 50, 50, { wrapId: WrapFlag.Y });
    expect(sideways.mapColatitude(0, 25)).toBe(0);
    expect(sideways.mapColatitude(79, 25)).toBe(0);
    expect(sideways.mapColatitude(39, 25)).toBe(sideways.mapColatitude(40, 25));
  });

  it.each<MapGeneratorType>(['RANDOM', 'FRACTAL', 'FRACTURE', 'ISLAND', 'FAIR'])(
    '%s generation is reproducible and produces one valid start per player',
    async generator => {
      const first = new MapManager(
        20,
        15,
        `parity-${generator}`,
        generator.toLowerCase(),
        generator
      );
      const second = new MapManager(
        20,
        15,
        `parity-${generator}`,
        generator.toLowerCase(),
        generator
      );

      await first.generateMap(players, generator);
      await second.generateMap(players, generator);

      expect(digest(first)).toBe(digest(second));
      expect(first.getMapData()!.startingPositions).toHaveLength(players.size);
    }
  );

  it('keeps the fixed small-map simulator starts separated', async () => {
    const manager = new MapManager(
      20,
      20,
      'map-424242',
      'random',
      'RANDOM',
      MapStartpos.DEFAULT,
      false,
      50,
      {},
      'earth-small',
      {},
      'classic'
    );

    await manager.generateMap(players, 'RANDOM');

    const starts = manager.getMapData()!.startingPositions;
    expect(starts).toHaveLength(2);
    expect(
      manager.getTopology().realDistance(starts[0].x, starts[0].y, starts[1].x, starts[1].y)
    ).toBeGreaterThanOrEqual(3);
  });

  it.each<MapGeneratorType>(['RANDOM', 'FRACTURE'])(
    '%s does not synthesize glacier strips along the map edges',
    async generator => {
      const manager = new MapManager(
        80,
        50,
        `polar-land-disabled-${generator}`,
        generator.toLowerCase(),
        generator
      );

      await manager.generateMap(players, generator);

      const map = manager.getMapData()!;
      const edgeTiles = [
        ...map.tiles.map(column => column[0]),
        ...map.tiles.map(column => column[49]),
      ];
      expect(edgeTiles).not.toContainEqual(expect.objectContaining({ terrain: 'glacier' }));
    }
  );

  it('generates real ISLAND maps without invoking the height-map fallback', async () => {
    const fallback = jest.spyOn(HeightBasedMapService.prototype, 'generateMap');
    const fourPlayers = new Map(players);
    fourPlayers.set('player-3', { ...players.get('player-1')!, id: 'player-3', playerNumber: 3 });
    fourPlayers.set('player-4', { ...players.get('player-2')!, id: 'player-4', playerNumber: 4 });
    const manager = new MapManager(
      80,
      50,
      'island-no-fallback',
      'island',
      'ISLAND',
      MapStartpos.ALL,
      false,
      50,
      {},
      'earth-small',
      { landPercent: 30 }
    );

    await manager.generateMap(fourPlayers, 'ISLAND');

    const map = manager.getMapData()!;
    const land = map.tiles.flat().filter(tile => isLandTile(tile.terrain));
    const fallbackCallCount = fallback.mock.calls.length;
    fallback.mockRestore();
    expect(fallbackCallCount).toBe(0);
    expect(new Set(land.map(tile => tile.continentId)).size).toBeGreaterThanOrEqual(4);
    expect(land.length / (map.width * map.height)).toBeGreaterThan(0.15);
    expect(land.length / (map.width * map.height)).toBeLessThan(0.4);
  });

  it('rejects dominant-continent RANDOM results before returning a quick map', async () => {
    const manager = new MapManager(
      40,
      25,
      'quick-quality-gate',
      'random',
      'RANDOM',
      MapStartpos.DEFAULT,
      false,
      50,
      {},
      'earth-small',
      { landPercent: 30 }
    );

    await manager.generateMap(players, 'RANDOM');

    const land = manager
      .getMapData()!
      .tiles.flat()
      .filter(tile => isLandTile(tile.terrain));
    const continentSizes = Object.values(
      land.reduce<Record<number, number>>((sizes, tile) => {
        sizes[tile.continentId] = (sizes[tile.continentId] ?? 0) + 1;
        return sizes;
      }, {})
    );
    expect(Math.max(...continentSizes) / land.length).toBeLessThanOrEqual(0.8);
  });

  it('classifies all water variants consistently in map metrics', () => {
    const tiles = Array.from({ length: 4 }, (_, x) =>
      Array.from({ length: 3 }, (_, y) => {
        const tile = createBaseTile(x, y);
        tile.terrain = 'deep_ocean';
        return tile;
      })
    );
    tiles[0][0].terrain = 'coast';
    tiles[1][0].terrain = 'lake';
    tiles[2][0].terrain = 'grassland';

    expect(new MapAccessService(4, 3).getLandPercent(tiles)).toBeCloseTo(100 / 12);
    expect(isFrozenTerrain('glacier')).toBe(true);
    expect(isFrozenTerrain('tundra')).toBe(false);
  });

  it('can route SCENARIO through an explicitly installed future provider', async () => {
    const manager = new MapManager(
      20,
      15,
      'ignored-for-scenario',
      'scenario',
      'SCENARIO',
      MapStartpos.DEFAULT,
      false,
      50,
      {},
      'earth-small'
    );
    manager.setScenarioProvider(new FreecivScenarioLoader());

    await manager.generateMap(players, 'SCENARIO');

    expect(manager.getMapData()).toMatchObject({
      width: 80,
      height: 50,
      wrapId: WrapFlag.X,
      seed: 'scenario:earth-small',
    });
    expect(manager.getMapData()!.startingPositions).toHaveLength(players.size);
    expect(manager.getTile(79, 0)).not.toBeNull();
  });

  it('joins continents across configured map wrapping', () => {
    const tiles = Array.from({ length: 4 }, (_, x) =>
      Array.from({ length: 2 }, (_, y) => createBaseTile(x, y))
    );
    tiles[0][0].terrain = 'grassland';
    tiles[3][0].terrain = 'grassland';

    new ContinentProcessor(4, 2, () => 0.5, { wrapId: WrapFlag.X }).generateContinents(tiles);

    expect(tiles[0][0].continentId).toBeGreaterThan(0);
    expect(tiles[3][0].continentId).toBe(tiles[0][0].continentId);
  });

  it('generates playable maps with hex/isometric topology and wrapping', async () => {
    const manager = new MapManager(
      24,
      18,
      'topology-generation',
      'random',
      'RANDOM',
      MapStartpos.VARIABLE,
      false,
      50,
      {
        topologyId: TopologyFlag.HEX | TopologyFlag.ISO,
        wrapId: WrapFlag.X,
      }
    );

    await manager.generateMap(players, 'RANDOM');

    expect(manager.getMapData()).toMatchObject({
      topologyId: TopologyFlag.HEX | TopologyFlag.ISO,
      wrapId: WrapFlag.X,
    });
    expect(manager.getMapData()!.startingPositions).toHaveLength(players.size);
  });

  it('builds FAIR maps from identical per-player island templates', async () => {
    const fourPlayers = new Map(players);
    fourPlayers.set('player-3', { ...players.get('player-1')!, id: 'player-3', playerNumber: 3 });
    fourPlayers.set('player-4', { ...players.get('player-2')!, id: 'player-4', playerNumber: 4 });
    const manager = new MapManager(
      40,
      25,
      'fair-template-parity',
      'fair',
      'FAIR',
      MapStartpos.DEFAULT
    );

    await manager.generateMap(fourPlayers, 'FAIR');

    const map = manager.getMapData()!;
    const signatures = map.startingPositions.map(start => {
      const continentId = map.tiles[start.x][start.y].continentId;
      const continent = map.tiles.flat().filter(tile => tile.continentId === continentId);
      return JSON.stringify({
        size: continent.length,
        terrain: continent.reduce<Record<string, number>>((counts, tile) => {
          counts[tile.terrain] = (counts[tile.terrain] ?? 0) + 1;
          return counts;
        }, {}),
        resources: continent.filter(tile => tile.resource).length,
        huts: continent.filter(tile => tile.improvements.includes('hut')).length,
      });
    });

    expect(
      new Set(map.startingPositions.map(start => map.tiles[start.x][start.y].continentId)).size
    ).toBe(fourPlayers.size);
    expect(new Set(signatures).size).toBe(1);
    expect(
      map.tiles
        .flat()
        .filter(tile => !isLandTile(tile.terrain))
        .every(tile => tile.continentId === 0)
    ).toBe(true);
  });

  it.each([
    MapStartpos.DEFAULT,
    MapStartpos.SINGLE,
    MapStartpos.TWO_ON_THREE,
    MapStartpos.ALL,
    MapStartpos.VARIABLE,
  ])('supports Freeciv start-position mode %s', async mode => {
    const width = 70;
    const height = 25;
    const tiles = Array.from({ length: width }, (_, x) =>
      Array.from({ length: height }, (_, y) => {
        const tile = createBaseTile(x, y);
        tile.terrain = 'deep_ocean';
        tile.continentId = -1;
        return tile;
      })
    );

    for (let continentId = 1; continentId <= 5; continentId++) {
      const left = 2 + (continentId - 1) * 13;
      for (let x = left; x < left + 10; x++) {
        for (let y = 7; y < 17; y++) {
          tiles[x][y].terrain = 'grassland';
          tiles[x][y].continentId = continentId;
          tiles[x][y].temperature = TemperatureType.TEMPERATE;
        }
      }
      // Give each synthetic continent a distinct high-value starter tile so
      // the reference start-position quality filter has valid candidates.
      tiles[left + 2][9].resource = 'wheat';
      tiles[left + 7][15].resource = 'wheat';
    }

    const starts = await new StartingPositionGenerator(width, height).generateStartingPositions(
      tiles,
      players,
      mode
    );

    expect(starts).toHaveLength(players.size);
    expect(new Set(starts.map(start => `${start.x},${start.y}`)).size).toBe(players.size);
    if (mode === MapStartpos.SINGLE) {
      expect(new Set(starts.map(start => tiles[start.x][start.y].continentId)).size).toBe(
        players.size
      );
    }
    if (mode === MapStartpos.TWO_ON_THREE) {
      expect(new Set(starts.map(start => tiles[start.x][start.y].continentId)).size).toBe(1);
    }
    if (mode === MapStartpos.ALL) {
      // No island contains half of this synthetic map's goodies, so Freeciv
      // falls back from ALL to VARIABLE.
      expect(new Set(starts.map(start => tiles[start.x][start.y].continentId)).size).toBe(2);
    }
  });
});
