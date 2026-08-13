/**
 * @module client/components/Canvas2D/mapTopologyGeometry
 * Shared Freeciv native, logical, natural/display, and GUI map geometry.
 *
 * Freeciv packets and CivJS tile storage use native coordinates. Isometric
 * maps also expose logical and natural helpers for topology code. The legacy
 * square-ISO browser renderer addresses its packet grid directly, while the
 * C2C3 ISO-hex path follows Freeciv's native -> logical -> GUI pipeline.
 *
 * @reference reference/freeciv/common/map.h:170-190
 * @reference reference/freeciv/common/world_object.h:52-60
 * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/map.js:231-276
 * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:132-158,247-387
 */
export interface MapPoint {
  x: number;
  y: number;
}

/** Freeciv `topo_flag`: ISO and HEX are bitwise enum ordinals zero and one. */
export const TOPOLOGY_ISO = 1 << 0;
export const TOPOLOGY_HEX = 1 << 1;

/** Freeciv treats either ISO or HEX as an isometric natural map. */
export const isIsometricTopology = (topologyId: number): boolean =>
  (topologyId & (TOPOLOGY_ISO | TOPOLOGY_HEX)) !== 0;

/** C2C3's ISO-hex topology requires Freeciv's native/logical conversion. */
export const usesNativeLogicalProjection = (topologyId: number): boolean =>
  (topologyId & (TOPOLOGY_ISO | TOPOLOGY_HEX)) === (TOPOLOGY_ISO | TOPOLOGY_HEX);

/**
 * Compare native tile positions in the order used by the map painter.
 *
 * The browser painter orders its map-grid positions by GUI Y and then GUI X.
 * Keeping this as a shared primitive prevents object insertion order from
 * changing terrain/entity occlusion.
 *
 * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:305-387
 */
export const compareMapPointsInPainterOrder = (
  first: MapPoint,
  second: MapPoint,
  topologyId = 0
): number => {
  if (!isIsometricTopology(topologyId)) {
    return first.y - second.y || first.x - second.x;
  }

  // For ISO-hex storage, GUI Y increases by native row and GUI X by native
  // column within that row after NATIVE_TO_MAP_POS. This is the same ordering
  // as comparing the projected tile origins, without needing map dimensions.
  if (usesNativeLogicalProjection(topologyId)) {
    return first.y - second.y || first.x - second.x;
  }

  return first.x + first.y - (second.x + second.y) || first.x - first.y - (second.x - second.y);
};

export const sortMapPointsInPainterOrder = <T extends MapPoint>(
  points: readonly T[],
  topologyId = 0
): T[] =>
  [...points].sort((first, second) => compareMapPointsInPainterOrder(first, second, topologyId));

export interface MapGeometry {
  /** Dimensions used by packets, persistence, and authoritative tile storage. */
  nativeWidth: number;
  nativeHeight: number;
  /** Freeciv natural/display dimensions; these are not packet dimensions. */
  displayWidth: number;
  displayHeight: number;
  isIsometric: boolean;
  isHex: boolean;
  topologyId: number;
}

export const createMapGeometry = (
  nativeWidth: number,
  nativeHeight: number,
  topologyId = 0
): MapGeometry => {
  const isIsometric = isIsometricTopology(topologyId);
  return {
    nativeWidth,
    nativeHeight,
    displayWidth: isIsometric ? nativeWidth * 2 : nativeWidth,
    displayHeight: nativeHeight,
    isIsometric,
    isHex: (topologyId & TOPOLOGY_HEX) !== 0,
    topologyId,
  };
};

export interface MapDirection {
  index: number;
  dx: number;
  dy: number;
  name: 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se';
}

/** Freeciv DIR8 ordering and packet-grid offsets. */
export const MAP_DIRECTIONS: readonly MapDirection[] = [
  { index: 0, dx: -1, dy: -1, name: 'nw' },
  { index: 1, dx: 0, dy: -1, name: 'n' },
  { index: 2, dx: 1, dy: -1, name: 'ne' },
  { index: 3, dx: -1, dy: 0, name: 'w' },
  { index: 4, dx: 1, dy: 0, name: 'e' },
  { index: 5, dx: -1, dy: 1, name: 'sw' },
  { index: 6, dx: 0, dy: 1, name: 's' },
  { index: 7, dx: 1, dy: 1, name: 'se' },
] as const;

/**
 * Freeciv's clockwise tileset directions. ISO-hex omits NE/SW; overhead hex
 * omits NW/SE. Square maps retain all eight valid directions.
 *
 * @reference reference/freeciv/common/map.c:1383-1466
 * @reference reference/freeciv/client/tilespec.c:2126-2143
 */
export const getValidMapDirections = (topologyId: number): readonly MapDirection[] => {
  const isHex = (topologyId & TOPOLOGY_HEX) !== 0;
  const isIso = (topologyId & TOPOLOGY_ISO) !== 0;
  const validNames = !isHex
    ? ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']
    : isIso
      ? ['n', 'e', 'se', 's', 'w', 'nw']
      : ['n', 'ne', 'e', 's', 'sw', 'w'];
  return validNames.map(name => MAP_DIRECTIONS.find(direction => direction.name === name)!);
};

/** Freeciv's cardinal directions in clockwise tileset order. */
export const getCardinalMapDirections = (topologyId: number): readonly MapDirection[] => {
  if ((topologyId & TOPOLOGY_HEX) !== 0) return getValidMapDirections(topologyId);
  const names = ['n', 'e', 's', 'w'];
  return names.map(name => MAP_DIRECTIONS.find(direction => direction.name === name)!);
};

/**
 * Freeciv NATIVE_TO_MAP_POS.  This is the logical/cartesian map coordinate
 * used by topology movement and the isometric GUI projection.
 */
export const nativeToMapPosition = (
  nativeX: number,
  nativeY: number,
  nativeWidth: number,
  isIsometric: boolean
): MapPoint => {
  if (!isIsometric) return { x: nativeX, y: nativeY };
  const mapX = Math.floor((nativeY + (nativeY & 1)) / 2 + nativeX);
  return { x: mapX, y: nativeY - mapX + nativeWidth };
};

/** Freeciv MAP_TO_NATIVE_POS. */
export const mapToNativePosition = (
  mapX: number,
  mapY: number,
  nativeWidth: number,
  isIsometric: boolean
): MapPoint => {
  if (!isIsometric) return { x: mapX, y: mapY };
  const nativeY = Math.floor(mapX + mapY - nativeWidth);
  return {
    x: Math.floor((2 * mapX - nativeY - (nativeY & 1)) / 2),
    y: nativeY,
  };
};

/**
 * Convert a logical map position to Freeciv's natural/display coordinates.
 * Natural coordinates are the rectangular display space; unlike logical map
 * coordinates, their ISO width is explicitly 2 * nativeWidth.
 */
export const mapToDisplayPosition = (
  mapX: number,
  mapY: number,
  geometry: MapGeometry
): MapPoint => {
  if (!geometry.isIsometric) return { x: mapX, y: mapY };
  const displayY = mapX + mapY - geometry.nativeWidth;
  return { x: 2 * mapX - displayY, y: displayY };
};

/** Freeciv NATURAL_TO_MAP_POS. */
export const displayToMapPosition = (
  displayX: number,
  displayY: number,
  geometry: MapGeometry
): MapPoint => {
  if (!geometry.isIsometric) return { x: displayX, y: displayY };
  const mapX = Math.floor((displayY + displayX) / 2);
  return {
    x: mapX,
    y: Math.floor(displayY - mapX + geometry.nativeWidth),
  };
};

/** Convert one authoritative native tile to its natural/display tile origin. */
export const nativeToDisplayPosition = (
  nativeX: number,
  nativeY: number,
  geometry: MapGeometry
): MapPoint => {
  const logical = nativeToMapPosition(nativeX, nativeY, geometry.nativeWidth, geometry.isIsometric);
  return mapToDisplayPosition(logical.x, logical.y, geometry);
};

/** Resolve a natural/display coordinate to the authoritative native tile. */
export const displayToNativePosition = (
  displayX: number,
  displayY: number,
  geometry: MapGeometry
): MapPoint => {
  const logical = displayToMapPosition(displayX, displayY, geometry);
  return mapToNativePosition(
    Math.floor(logical.x),
    Math.floor(logical.y),
    geometry.nativeWidth,
    geometry.isIsometric
  );
};

/** Convert a logical map position to the GUI pixel origin used by the canvas. */
export const mapToGuiPosition = (
  mapX: number,
  mapY: number,
  tileWidth: number,
  tileHeight: number
): MapPoint => ({
  x: ((mapX - mapY) * tileWidth) >> 1,
  y: ((mapX + mapY) * tileHeight) >> 1,
});

/**
 * Invert the browser isometric projection without discarding sub-tile
 * precision. Overview viewport geometry needs this continuous form so the
 * outline describes the exact painted GUI rectangle rather than four tiles
 * containing its corners.
 *
 * @reference reference/freeciv/client/overview_common.c:51-79
 * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:192-233
 */
export const guiToMapPositionContinuous = (
  guiX: number,
  guiY: number,
  tileWidth: number,
  tileHeight: number
): MapPoint => {
  const adjustedX = guiX - (tileWidth >> 1);
  const denominator = tileWidth * tileHeight;
  if (denominator === 0) return { x: 0, y: 0 };
  return {
    x: (adjustedX * tileHeight + guiY * tileWidth) / denominator,
    y: (guiY * tileWidth - adjustedX * tileHeight) / denominator,
  };
};

/** Mirror freeciv-web's gui_to_map_pos() tile selection conversion. */
export const guiToMapPosition = (
  guiX: number,
  guiY: number,
  tileWidth: number,
  tileHeight: number,
  hexWidth = 0,
  hexHeight = 0
): MapPoint => {
  if ((hexWidth > 0 || hexHeight > 0) && tileWidth > 0 && tileHeight > 0) {
    const divide = (value: number, divisor: number): number => Math.floor(value / divisor);
    const x = divide(guiX, tileWidth);
    const y = divide(guiY, tileHeight);
    let dx = guiX - x * tileWidth;
    let dy = guiY - y * tileHeight;
    const xMultiplier = dx >= tileWidth / 2 ? -1 : 1;
    const yMultiplier = dy >= tileHeight / 2 ? -1 : 1;
    dx = dx >= tileWidth / 2 ? tileWidth - 1 - dx : dx;
    dy = dy >= tileHeight / 2 ? tileHeight - 1 - dy : dy;
    const comparison =
      hexWidth > 0
        ? (dx - hexWidth / 2) * (tileHeight / 2) -
          (tileHeight / 2 - 1 - dy) * (tileWidth / 2 - hexWidth)
        : (dy - hexHeight / 2) * (tileWidth / 2) -
          (tileWidth / 2 - 1 - dx) * (tileHeight / 2 - hexHeight);
    const modifier = comparison < 0 ? -1 : 0;
    return {
      x: x + y + (modifier * (xMultiplier + yMultiplier)) / 2,
      y: y - x + (modifier * (yMultiplier - xMultiplier)) / 2,
    };
  }
  const point = guiToMapPositionContinuous(guiX, guiY, tileWidth, tileHeight);
  return { x: Math.floor(point.x), y: Math.floor(point.y) };
};

/**
 * Project one authoritative tile into the tileset GUI coordinate space.
 * C2C3 ISO-hex maps follow Freeciv's native-to-logical conversion. The
 * topology-1 compatibility path retains freeciv-web's direct packet grid.
 *
 * @reference reference/freeciv/client/mapview_common.c:886-905
 * @reference reference/freeciv/common/map.h:170-190
 * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:81-96,243-249
 */
export const nativeToGuiPosition = (
  nativeX: number,
  nativeY: number,
  geometry: MapGeometry,
  tileWidth: number,
  tileHeight: number
): MapPoint => {
  const logical = usesNativeLogicalProjection(geometry.topologyId)
    ? nativeToMapPosition(nativeX, nativeY, geometry.nativeWidth, true)
    : { x: nativeX, y: nativeY };
  return mapToGuiPosition(logical.x, logical.y, tileWidth, tileHeight);
};

/** Convert GUI coordinates back to the authoritative native tile grid. */
export const guiToNativePosition = (
  guiX: number,
  guiY: number,
  geometry: MapGeometry,
  tileWidth: number,
  tileHeight: number,
  hexWidth = 0,
  hexHeight = 0
): MapPoint => {
  const logical = guiToMapPosition(guiX, guiY, tileWidth, tileHeight, hexWidth, hexHeight);
  return usesNativeLogicalProjection(geometry.topologyId)
    ? mapToNativePosition(logical.x, logical.y, geometry.nativeWidth, true)
    : logical;
};

/** Project a GUI point into natural/display coordinates for overview outlines. */
export const guiToDisplayPosition = (
  guiX: number,
  guiY: number,
  geometry: MapGeometry,
  tileWidth: number,
  tileHeight: number
): MapPoint => {
  const logical = guiToMapPosition(guiX, guiY, tileWidth, tileHeight);
  return mapToDisplayPosition(logical.x, logical.y, geometry);
};

/** GUI translation for one complete native-axis map period. */
export const nativeAxisGuiPeriod = (
  axis: 'x' | 'y',
  geometry: MapGeometry,
  tileWidth: number,
  tileHeight: number
): MapPoint => {
  const origin = nativeToGuiPosition(0, 0, geometry, tileWidth, tileHeight);
  const translated = nativeToGuiPosition(
    axis === 'x' ? geometry.nativeWidth : 0,
    axis === 'y' ? geometry.nativeHeight : 0,
    geometry,
    tileWidth,
    tileHeight
  );
  return { x: translated.x - origin.x, y: translated.y - origin.y };
};

/** Natural/display translation for one complete native-axis map period. */
export const nativeAxisDisplayPeriod = (axis: 'x' | 'y', geometry: MapGeometry): MapPoint => {
  const origin = nativeToDisplayPosition(0, 0, geometry);
  const translated = nativeToDisplayPosition(
    axis === 'x' ? geometry.nativeWidth : 0,
    axis === 'y' ? geometry.nativeHeight : 0,
    geometry
  );
  return { x: translated.x - origin.x, y: translated.y - origin.y };
};

/**
 * Bounds of the projected map tile origins plus one tile-sized draw area.
 * This is used by camera constraints and orientation tests; it deliberately
 * describes projected GUI bounds, not native packet dimensions.
 */
export interface ProjectedMapBounds extends MapPoint {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export const getProjectedMapBounds = (
  geometry: MapGeometry,
  tileWidth: number,
  tileHeight: number
): ProjectedMapBounds => {
  if (geometry.nativeWidth <= 0 || geometry.nativeHeight <= 0) {
    return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }

  const corners = [
    nativeToGuiPosition(0, 0, geometry, tileWidth, tileHeight),
    nativeToGuiPosition(geometry.nativeWidth - 1, 0, geometry, tileWidth, tileHeight),
    nativeToGuiPosition(0, geometry.nativeHeight - 1, geometry, tileWidth, tileHeight),
    nativeToGuiPosition(
      geometry.nativeWidth - 1,
      geometry.nativeHeight - 1,
      geometry,
      tileWidth,
      tileHeight
    ),
  ];
  const left = Math.min(...corners.map(point => point.x));
  const top = Math.min(...corners.map(point => point.y));
  const right = Math.max(...corners.map(point => point.x + tileWidth));
  const bottom = Math.max(...corners.map(point => point.y + tileHeight));
  return { x: left, y: top, left, top, right, bottom, width: right - left, height: bottom - top };
};

const wrap = (value: number, range: number): number => ((value % range) + range) % range;

export const normalizeMapPosition = (
  mapX: number,
  mapY: number,
  nativeWidth: number,
  nativeHeight: number,
  topologyId: number,
  wrapId: number
): MapPoint => {
  const useLogicalProjection = usesNativeLogicalProjection(topologyId);
  const native = useLogicalProjection
    ? mapToNativePosition(mapX, mapY, nativeWidth, true)
    : { x: mapX, y: mapY };
  if ((wrapId & 1) !== 0) native.x = wrap(native.x, nativeWidth);
  if ((wrapId & 2) !== 0) native.y = wrap(native.y, nativeHeight);
  return useLogicalProjection ? nativeToMapPosition(native.x, native.y, nativeWidth, true) : native;
};

/**
 * Apply one logical Freeciv direction to an authoritative native tile.
 * @reference reference/freeciv/common/map.c:1383-1466
 * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/map.js:215-219,341-350
 */
export const stepNativeMapPosition = (
  nativeX: number,
  nativeY: number,
  mapDx: number,
  mapDy: number,
  nativeWidth: number,
  nativeHeight: number,
  topologyId: number,
  wrapId: number
): MapPoint | null => {
  const useLogicalProjection = usesNativeLogicalProjection(topologyId);
  const logical = useLogicalProjection
    ? nativeToMapPosition(nativeX, nativeY, nativeWidth, true)
    : { x: nativeX, y: nativeY };
  const candidate = useLogicalProjection
    ? mapToNativePosition(logical.x + mapDx, logical.y + mapDy, nativeWidth, true)
    : { x: nativeX + mapDx, y: nativeY + mapDy };

  if ((wrapId & 1) !== 0) candidate.x = wrap(candidate.x, nativeWidth);
  if ((wrapId & 2) !== 0) candidate.y = wrap(candidate.y, nativeHeight);
  if (
    candidate.x < 0 ||
    candidate.x >= nativeWidth ||
    candidate.y < 0 ||
    candidate.y >= nativeHeight
  ) {
    return null;
  }
  return candidate;
};

/**
 * Return a logical map period for compatibility with topology movement code.
 * GUI and display consumers should use nativeAxisGuiPeriod/nativeAxisDisplayPeriod.
 */
export const nativeAxisMapPeriod = (
  axis: 'x' | 'y',
  nativeWidth: number,
  nativeHeight: number,
  topologyId: number
): MapPoint => {
  const geometry = createMapGeometry(nativeWidth, nativeHeight, topologyId);
  const origin = nativeToMapPosition(0, 0, nativeWidth, geometry.isIsometric);
  const translated = nativeToMapPosition(
    axis === 'x' ? nativeWidth : 0,
    axis === 'y' ? nativeHeight : 0,
    nativeWidth,
    geometry.isIsometric
  );
  return { x: translated.x - origin.x, y: translated.y - origin.y };
};
