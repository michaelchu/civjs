import {
  mapToNativePosition,
  MapTopology,
  nativeToMapPosition,
  normalizeTopologyId,
  TopologyFlag,
  WrapFlag,
} from '@game/map/MapTopology';

describe('MapTopology', () => {
  /**
   * @evidence parity
   * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/map.js:35-38
   * @assertion CivJS uses Freeciv's serialized ISO and HEX flag positions in MAP_INFO and repairs maps written with CivJS's former shifted values.
   * @c2c3-surface map-generation
   * @c2c3-surface-scenario boundary
   */
  it('uses Freeciv topology packet flags and repairs shifted CivJS map values', () => {
    expect(TopologyFlag).toEqual({ ISO: 1, HEX: 2 });
    expect(normalizeTopologyId(4)).toBe(TopologyFlag.ISO);
    expect(normalizeTopologyId(8)).toBe(TopologyFlag.HEX);
    expect(normalizeTopologyId(12)).toBe(TopologyFlag.ISO | TopologyFlag.HEX);
    expect(new MapTopology(10, 8, { topologyId: 12 }).topologyId).toBe(
      TopologyFlag.ISO | TopologyFlag.HEX
    );
  });

  it('returns eight neighbors for the interior of a square map', () => {
    const topology = new MapTopology(10, 8);

    expect(topology.getNeighbors(4, 3)).toHaveLength(8);
    expect(topology.realDistance(1, 1, 4, 3)).toBe(3);
    expect(topology.mapDistance(1, 1, 4, 3)).toBe(5);
    expect(topology.squaredDistance(1, 1, 4, 3)).toBe(13);
  });

  it('normalizes and measures across wrapped map edges', () => {
    const topology = new MapTopology(10, 8, { wrapId: WrapFlag.X });

    expect(topology.normalize(-1, 3)).toEqual({ x: 9, y: 3 });
    expect(topology.normalize(4, -1)).toBeNull();
    expect(topology.realDistance(0, 3, 9, 3)).toBe(1);
    expect(topology.mapDistance(0, 3, 9, 3)).toBe(1);
    expect(topology.getNeighbors(0, 3)).toContainEqual({ x: 9, y: 3 });
  });

  it('uses six directions and Freeciv distances for non-isometric hex maps', () => {
    const topology = new MapTopology(10, 8, { topologyId: TopologyFlag.HEX });

    expect(topology.getDirections()).toHaveLength(6);
    expect(topology.getNeighbors(4, 3)).toEqual(
      expect.arrayContaining([
        { x: 5, y: 2 },
        { x: 5, y: 3 },
        { x: 5, y: 4 },
        { x: 4, y: 4 },
        { x: 3, y: 3 },
        { x: 4, y: 2 },
      ])
    );
    expect(topology.getNeighbors(4, 3)).not.toContainEqual({ x: 4, y: 1 });
    expect(topology.getNeighbors(4, 3)).not.toContainEqual({ x: 4, y: 5 });
    expect(topology.realDistance(1, 1, 4, 4)).toBe(4);
    expect(topology.realDistance(1, 4, 4, 1)).toBe(5);
  });

  it('uses the opposite diagonal pair for isometric hex maps', () => {
    const topology = new MapTopology(10, 8, {
      topologyId: TopologyFlag.ISO | TopologyFlag.HEX,
    });

    expect(topology.getDirections()).toHaveLength(6);
    expect(topology.getNeighbors(4, 3)).toEqual(
      expect.arrayContaining([
        { x: 5, y: 2 },
        { x: 5, y: 4 },
        { x: 4, y: 5 },
        { x: 4, y: 4 },
        { x: 4, y: 2 },
        { x: 4, y: 1 },
      ])
    );
    expect(topology.getNeighbors(4, 3)).toHaveLength(6);
  });

  /**
   * @reference reference/freeciv/common/map.h:170-180
   * @reference reference/freeciv/common/map.c:1162-1193
   */
  it('matches C2C3 native/map conversion and wrapped seam fixtures', () => {
    const topology = new MapTopology(32, 64, {
      topologyId: TopologyFlag.ISO | TopologyFlag.HEX,
      wrapId: WrapFlag.X | WrapFlag.Y,
    });

    expect(nativeToMapPosition(0, 0, 32, true)).toEqual({ x: 0, y: 32 });
    expect(nativeToMapPosition(31, 63, 32, true)).toEqual({ x: 63, y: 32 });
    expect(mapToNativePosition(63, 32, 32, true)).toEqual({ x: 31, y: 63 });
    expect(topology.normalize(-1, -1)).toEqual({ x: 31, y: 63 });
    expect(topology.getNeighbors(0, 0)).toContainEqual({ x: 31, y: 63 });
    expect(topology.realDistance(0, 0, 31, 63)).toBe(1);
  });

  it('deduplicates neighbors on tiny wrapped maps', () => {
    const topology = new MapTopology(2, 2, {
      wrapId: WrapFlag.X | WrapFlag.Y,
    });

    expect(topology.getNeighbors(0, 0)).toEqual(
      expect.arrayContaining([
        { x: 0, y: 1 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ])
    );
    expect(topology.getNeighbors(0, 0)).toHaveLength(3);
  });

  it('separates Freeciv square and squared-circle iterator radii', () => {
    const topology = new MapTopology(10, 8);

    expect(topology.getPositionsWithinSquareRadius(4, 3, 2)).toHaveLength(25);
    expect(topology.getPositionsWithinSquaredRadius(4, 3, 2)).toEqual(
      expect.arrayContaining([
        { x: 4, y: 3 },
        { x: 3, y: 2 },
        { x: 5, y: 4 },
      ])
    );
    expect(topology.getPositionsWithinSquaredRadius(4, 3, 2)).toHaveLength(9);
  });

  /**
   * @evidence parity
   * @reference reference/freeciv/data/civ2civ3/game.ruleset:810-815
   * @reference reference/freeciv/common/map.h:396-424
   * @assertion Civ2Civ3's default ISO-hex topology interprets the nuclear squared radius of two as its six-tile first hex ring plus the center.
   * @c2c3-surface combat
   * @c2c3-surface-scenario boundary
   */
  it('uses the c2c3 default ISO-hex squared blast circle', () => {
    const topology = new MapTopology(10, 8, {
      topologyId: TopologyFlag.ISO | TopologyFlag.HEX,
      wrapId: WrapFlag.X | WrapFlag.Y,
    });

    expect(topology.getPositionsWithinSquaredRadius(4, 3, 2)).toHaveLength(7);
    expect(topology.getPositionsWithinSquaredRadius(4, 3, 2)).not.toContainEqual({ x: 5, y: 3 });
    expect(topology.getPositionsWithinSquaredRadius(4, 3, 2)).toContainEqual({ x: 5, y: 2 });
  });
});
