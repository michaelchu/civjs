/**
 * @module server/game/map/MapTopology
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

/**
 * Serialized Freeciv topology flags. Bits zero and one are retained for the
 * legacy WrapX/WrapY topology values, so ISO and HEX start at bits two and
 * three on the wire.
 *
 * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/map.js:35-38
 * @reference reference/freeciv/common/fc_types.h:452-465
 */
export const TopologyFlag = {
  ISO: 1 << 2,
  HEX: 1 << 3,
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

/** Freeciv MAP_TO_NATIVE_POS for isometric maps. */
export function mapToNativePosition(
  mapX: number,
  mapY: number,
  nativeWidth: number,
  isIsometric: boolean
): MapPosition {
  if (!isIsometric) return { x: mapX, y: mapY };
  const nativeY = mapX + mapY - nativeWidth;
  return {
    x: Math.floor((2 * mapX - nativeY - (nativeY & 1)) / 2),
    y: nativeY,
  };
}

/** Freeciv NATIVE_TO_MAP_POS for isometric maps. */
export function nativeToMapPosition(
  nativeX: number,
  nativeY: number,
  nativeWidth: number,
  isIsometric: boolean
): MapPosition {
  if (!isIsometric) return { x: nativeX, y: nativeY };
  const mapX = Math.floor((nativeY + (nativeY & 1)) / 2 + nativeX);
  return { x: mapX, y: nativeY - mapX + nativeWidth };
}

/**
 * Translate the topology values written by CivJS before it adopted Freeciv's
 * serialized flag positions. Those values were only ever used internally:
 * 1 = ISO, 2 = HEX, and 3 = ISO|HEX. Freeciv's topology packet has always
 * used 4 and 8 for ISO and HEX respectively.
 */
export function normalizeTopologyId(topologyId: number): number {
  switch (topologyId) {
    case 1:
      return TopologyFlag.ISO;
    case 2:
      return TopologyFlag.HEX;
    case 3:
      return TopologyFlag.ISO | TopologyFlag.HEX;
    default:
      return topologyId;
  }
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
    this.topologyId = normalizeTopologyId(options.topologyId ?? 0);
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

  getPositionsWithinRadius(x: number, y: number, radius: number): MapPosition[] {
    const positions = new Map<string, MapPosition>();
    const origin = nativeToMapPosition(x, y, this.width, this.isIsometric());
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const candidate = mapToNativePosition(
          origin.x + dx,
          origin.y + dy,
          this.width,
          this.isIsometric()
        );
        const position = this.normalize(candidate.x, candidate.y);
        if (position && this.realDistance(x, y, position.x, position.y) <= radius) {
          positions.set(`${position.x},${position.y}`, position);
        }
      }
    }
    return [...positions.values()];
  }

  /**
   * Return every position in Freeciv's square iterator radius.
   *
   * Unlike a movement radius, this intentionally retains every normalized
   * coordinate in the dx/dy square.  Effects such as SDI interception use
   * `square_iterate()` rather than a circular or real-distance search.
   *
   * @reference reference/freeciv/common/map.h:372-391
   */
  getPositionsWithinSquareRadius(x: number, y: number, radius: number): MapPosition[] {
    const positions = new Map<string, MapPosition>();
    const boundedRadius = Math.max(0, Math.floor(radius));
    const origin = nativeToMapPosition(x, y, this.width, this.isIsometric());
    for (let dx = -boundedRadius; dx <= boundedRadius; dx++) {
      for (let dy = -boundedRadius; dy <= boundedRadius; dy++) {
        const candidate = mapToNativePosition(
          origin.x + dx,
          origin.y + dy,
          this.width,
          this.isIsometric()
        );
        const position = this.normalize(candidate.x, candidate.y);
        if (position) positions.set(`${position.x},${position.y}`, position);
      }
    }
    return [...positions.values()];
  }

  /**
   * Return every position in Freeciv's circular, squared-distance radius.
   *
   * Freeciv's `circle_iterate()` accepts a squared radius rather than a
   * movement radius. This matters for effects such as
   * `Nuke_Blast_Radius_1_Sq = 2`: it includes the eight neighbouring tiles
   * on a square map, including diagonals.
   *
   * @reference reference/freeciv/common/map.h:396-424
   */
  getPositionsWithinSquaredRadius(x: number, y: number, radiusSquared: number): MapPosition[] {
    const positions = new Map<string, MapPosition>();
    const radius = Math.floor(Math.sqrt(Math.max(0, radiusSquared)));
    const origin = nativeToMapPosition(x, y, this.width, this.isIsometric());
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const candidate = mapToNativePosition(
          origin.x + dx,
          origin.y + dy,
          this.width,
          this.isIsometric()
        );
        const position = this.normalize(candidate.x, candidate.y);
        if (position && this.squaredDistance(x, y, position.x, position.y) <= radiusSquared) {
          positions.set(`${position.x},${position.y}`, position);
        }
      }
    }
    return [...positions.values()];
  }

  private positionsForDirections(
    x: number,
    y: number,
    directions: ReadonlyArray<MapVector>
  ): MapPosition[] {
    const neighbors = new Map<string, MapPosition>();
    const origin = nativeToMapPosition(x, y, this.width, this.isIsometric());

    for (const { dx, dy } of directions) {
      const candidate = mapToNativePosition(
        origin.x + dx,
        origin.y + dy,
        this.width,
        this.isIsometric()
      );
      const position = this.normalize(candidate.x, candidate.y);
      if (!position || (position.x === x && position.y === y)) continue;
      neighbors.set(`${position.x},${position.y}`, position);
    }

    return [...neighbors.values()];
  }

  distanceVector(fromX: number, fromY: number, toX: number, toY: number): MapVector {
    let nativeDx = toX - fromX;
    let nativeDy = toY - fromY;

    if (this.hasWrapFlag(WrapFlag.X)) {
      nativeDx = this.minimumWrappedDelta(nativeDx, this.width);
    }
    if (this.hasWrapFlag(WrapFlag.Y)) {
      nativeDy = this.minimumWrappedDelta(nativeDy, this.height);
    }

    const from = nativeToMapPosition(fromX, fromY, this.width, this.isIsometric());
    const to = nativeToMapPosition(
      fromX + nativeDx,
      fromY + nativeDy,
      this.width,
      this.isIsometric()
    );
    return { dx: to.x - from.x, dy: to.y - from.y };
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
