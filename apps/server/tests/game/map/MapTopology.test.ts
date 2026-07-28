import { MapTopology, TopologyFlag, WrapFlag } from '@game/map/MapTopology';

describe('MapTopology', () => {
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
    expect(topology.getNeighbors(4, 3)).not.toContainEqual({ x: 3, y: 2 });
    expect(topology.getNeighbors(4, 3)).not.toContainEqual({ x: 5, y: 4 });
    expect(topology.realDistance(1, 1, 4, 4)).toBe(6);
    expect(topology.realDistance(1, 4, 4, 1)).toBe(3);
  });

  it('uses the opposite diagonal pair for isometric hex maps', () => {
    const topology = new MapTopology(10, 8, {
      topologyId: TopologyFlag.ISO | TopologyFlag.HEX,
    });

    expect(topology.getDirections()).toHaveLength(6);
    expect(topology.getNeighbors(4, 3)).not.toContainEqual({ x: 5, y: 2 });
    expect(topology.getNeighbors(4, 3)).not.toContainEqual({ x: 3, y: 4 });
    expect(topology.realDistance(1, 1, 4, 4)).toBe(3);
    expect(topology.realDistance(1, 4, 4, 1)).toBe(6);
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
});
