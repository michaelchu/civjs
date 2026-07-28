/**
 * Freeciv-compatible map topology and wrapping primitives.
 *
 * CivJS stores tiles in native rectangular coordinates. This class is the
 * single authority for deciding which native-coordinate steps are valid,
 * normalizing wrapped coordinates, and calculating map distances.
 *
 * @reference reference/freeciv/common/fc_types.h topo_flag, wrap_flag
 * @reference reference/freeciv/common/map.c map_vector_to_real_distance()
 * @reference reference/freeciv/common/map.c base_map_distance_vector()
 */

export const TopologyFlag = {
  ISO: 1 << 0,
  HEX: 1 << 1,
} as const;

export const WrapFlag = {
  X: 1 << 0,
  Y: 1 << 1,
} as const;

export interface MapPosition {
  x: number;
  y: number;
}

export interface MapVector {
  dx: number;
  dy: number;
}

export interface MapTopologyOptions {
  topologyId?: number;
  wrapId?: number;
}

const SQUARE_DIRECTIONS: ReadonlyArray<MapVector> = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 1, dy: 1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: -1, dy: -1 },
];

export class MapTopology {
  readonly width: number;
  readonly height: number;
  readonly topologyId: number;
  readonly wrapId: number;

  constructor(width: number, height: number, options: MapTopologyOptions = {}) {
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw new Error(`Invalid map dimensions ${width}x${height}`);
    }

    this.width = width;
    this.height = height;
    this.topologyId = options.topologyId ?? 0;
    this.wrapId = options.wrapId ?? 0;
  }

  hasTopologyFlag(flag: number): boolean {
    return (this.topologyId & flag) !== 0;
  }

  hasWrapFlag(flag: number): boolean {
    return (this.wrapId & flag) !== 0;
  }

  isHex(): boolean {
    return this.hasTopologyFlag(TopologyFlag.HEX);
  }

  isIsometric(): boolean {
    return this.hasTopologyFlag(TopologyFlag.ISO);
  }

  isValidCoordinate(x: number, y: number): boolean {
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      x >= 0 &&
      x < this.width &&
      y >= 0 &&
      y < this.height
    );
  }

  normalize(x: number, y: number): MapPosition | null {
    let normalizedX = x;
    let normalizedY = y;

    if (this.hasWrapFlag(WrapFlag.X)) {
      normalizedX = this.wrap(normalizedX, this.width);
    }
    if (this.hasWrapFlag(WrapFlag.Y)) {
      normalizedY = this.wrap(normalizedY, this.height);
    }

    return this.isValidCoordinate(normalizedX, normalizedY)
      ? { x: normalizedX, y: normalizedY }
      : null;
  }

  getDirections(): ReadonlyArray<MapVector> {
    if (!this.isHex()) return SQUARE_DIRECTIONS;

    return SQUARE_DIRECTIONS.filter(({ dx, dy }) => {
      if (this.isIsometric()) {
        // Freeciv iso-hex excludes northeast and southwest.
        return !(dx === 1 && dy === -1) && !(dx === -1 && dy === 1);
      }

      // Freeciv non-isometric hex excludes northwest and southeast.
      return !(dx === -1 && dy === -1) && !(dx === 1 && dy === 1);
    });
  }

  getCardinalDirections(): ReadonlyArray<MapVector> {
    if (this.isHex()) return this.getDirections();
    return SQUARE_DIRECTIONS.filter(({ dx, dy }) => dx === 0 || dy === 0);
  }

  getNeighbors(x: number, y: number): MapPosition[] {
    return this.positionsForDirections(x, y, this.getDirections());
  }

  getCardinalNeighbors(x: number, y: number): MapPosition[] {
    return this.positionsForDirections(x, y, this.getCardinalDirections());
  }

  private positionsForDirections(
    x: number,
    y: number,
    directions: ReadonlyArray<MapVector>
  ): MapPosition[] {
    const neighbors = new Map<string, MapPosition>();

    for (const { dx, dy } of directions) {
      const position = this.normalize(x + dx, y + dy);
      if (!position || (position.x === x && position.y === y)) continue;
      neighbors.set(`${position.x},${position.y}`, position);
    }

    return [...neighbors.values()];
  }

  distanceVector(fromX: number, fromY: number, toX: number, toY: number): MapVector {
    let dx = toX - fromX;
    let dy = toY - fromY;

    if (this.hasWrapFlag(WrapFlag.X)) {
      dx = this.minimumWrappedDelta(dx, this.width);
    }
    if (this.hasWrapFlag(WrapFlag.Y)) {
      dy = this.minimumWrappedDelta(dy, this.height);
    }

    return { dx, dy };
  }

  realDistance(fromX: number, fromY: number, toX: number, toY: number): number {
    const { dx, dy } = this.distanceVector(fromX, fromY, toX, toY);
    return this.vectorToRealDistance(dx, dy);
  }

  mapDistance(fromX: number, fromY: number, toX: number, toY: number): number {
    const { dx, dy } = this.distanceVector(fromX, fromY, toX, toY);
    return this.isHex() ? this.vectorToRealDistance(dx, dy) : Math.abs(dx) + Math.abs(dy);
  }

  squaredDistance(fromX: number, fromY: number, toX: number, toY: number): number {
    const { dx, dy } = this.distanceVector(fromX, fromY, toX, toY);
    if (this.isHex()) {
      const distance = this.vectorToRealDistance(dx, dy);
      return distance * distance;
    }
    return dx * dx + dy * dy;
  }

  private vectorToRealDistance(dx: number, dy: number): number {
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (!this.isHex()) return Math.max(absDx, absDy);

    const disallowedDiagonal = this.isIsometric()
      ? (dx < 0 && dy > 0) || (dx > 0 && dy < 0)
      : dx * dy > 0;

    return disallowedDiagonal ? absDx + absDy : Math.max(absDx, absDy);
  }

  private minimumWrappedDelta(delta: number, size: number): number {
    return this.wrap(delta + Math.floor(size / 2), size) - Math.floor(size / 2);
  }

  private wrap(value: number, size: number): number {
    return ((value % size) + size) % size;
  }
}
