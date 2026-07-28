import { createHash } from 'node:crypto';
import { MapManager, type MapGeneratorType } from '@game/managers/MapManager';
import { PlayerState } from '@game/managers/GameManager';
import { MapStartpos, TemperatureType } from '@game/map/MapTypes';
import { ContinentProcessor } from '@game/map/terrain/ContinentProcessor';
import { createBaseTile } from '@game/map/TerrainUtils';
import { TopologyFlag, WrapFlag } from '@game/map/MapTopology';
import { StartingPositionGenerator } from '@game/map/StartingPositionGenerator';

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

  it('routes SCENARIO through the packaged Freeciv loader', async () => {
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
    if (mode === MapStartpos.ALL || mode === MapStartpos.TWO_ON_THREE) {
      expect(new Set(starts.map(start => tiles[start.x][start.y].continentId)).size).toBe(1);
    }
  });
});
