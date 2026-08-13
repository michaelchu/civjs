import { RiverGenerator } from '@game/map/RiverGenerator';
import type { MapTile } from '@game/map/MapTypes';
import { TopologyFlag } from '@game/map/MapTopology';
import { createBaseTile, tileHasRiver } from '@game/map/TerrainUtils';

type RiverMaskCalculator = {
  calculateRiverMaskForTile(tiles: MapTile[][], x: number, y: number): number;
};

const createLandMap = (width: number, height: number): MapTile[][] =>
  Array.from({ length: width }, (_, x) =>
    Array.from({ length: height }, (_, y) => ({
      ...createBaseTile(x, y),
      terrain: 'grassland' as const,
    }))
  );

describe('RiverGenerator topology masks', () => {
  it('distinguishes omitted masks from isolated zero-mask river extras', () => {
    expect(tileHasRiver({})).toBe(false);
    expect(tileHasRiver({ riverMask: 0, improvements: [] })).toBe(false);
    expect(tileHasRiver({ riverMask: 0, improvements: ['river'] })).toBe(true);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/common/map.c:1383-1466
   * @reference reference/freeciv/client/tilespec.c:6167-6195
   * @assertion ISO-hex rivers encode the tileset's six clockwise cardinal
   * directions after logical steps are converted back to native storage.
   */
  it('encodes N, E, SE, S, W, and NW connections in six bits', () => {
    const tiles = createLandMap(10, 8);
    const neighbors = [
      { x: 5, y: 2 },
      { x: 5, y: 4 },
      { x: 4, y: 5 },
      { x: 4, y: 4 },
      { x: 4, y: 2 },
      { x: 4, y: 1 },
    ];
    for (const position of neighbors) tiles[position.x][position.y].riverMask = 1;

    const generator = new RiverGenerator(10, 8, () => 0, {
      topologyId: TopologyFlag.ISO | TopologyFlag.HEX,
    });
    const calculator = generator as unknown as RiverMaskCalculator;

    expect(calculator.calculateRiverMaskForTile(tiles, 4, 3)).toBe(0b111111);
  });

  it('retains the four-bit N, E, S, W mask for square maps', () => {
    const tiles = createLandMap(5, 5);
    for (const position of [
      { x: 2, y: 1 },
      { x: 3, y: 2 },
      { x: 2, y: 3 },
      { x: 1, y: 2 },
    ]) {
      tiles[position.x][position.y].riverMask = 1;
    }
    const generator = new RiverGenerator(5, 5, () => 0);
    const calculator = generator as unknown as RiverMaskCalculator;

    expect(calculator.calculateRiverMaskForTile(tiles, 2, 2)).toBe(0b1111);
  });
});
