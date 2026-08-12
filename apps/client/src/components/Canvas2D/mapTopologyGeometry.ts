/**
 * @module client/components/Canvas2D/mapTopologyGeometry
 * Shared Freeciv native, logical, natural/display, and GUI map geometry.
 *
 * Freeciv packets and CivJS tile storage use native coordinates. Isometric
 * maps also expose logical and natural coordinate helpers for topology and
 * native-map conversions. The browser 2D client itself follows freeciv-web's
 * tile path: tile x/y values are passed directly to map_to_gui_pos() and
 * gui_to_map_pos(). Keeping that distinction explicit prevents the C
 * conversion helpers from rotating the web renderer a second time.
 *
 * @reference reference/freeciv/common/map.h:170-190
 * @reference reference/freeciv/common/world_object.h:52-60
 * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/map.js:231-276
 * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:132-158,247-309
 */
export interface MapPoint {
  x: number;
  y: number;
}

export const TOPOLOGY_ISO = 1 << 2;
export const TOPOLOGY_HEX = 1 << 3;

/** Freeciv treats either ISO or HEX as an isometric natural map. */
export const isIsometricTopology = (topologyId: number): boolean =>
  (topologyId & (TOPOLOGY_ISO | TOPOLOGY_HEX)) !== 0;

export interface MapGeometry {
  /** Dimensions used by packets, persistence, and authoritative tile storage. */
  nativeWidth: number;
  nativeHeight: number;
  /** Freeciv natural/display dimensions; these are not packet dimensions. */
  displayWidth: number;
  displayHeight: number;
  isIsometric: boolean;
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
  };
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

/** Mirror freeciv-web's gui_to_map_pos() tile selection conversion. */
export const guiToMapPosition = (
  guiX: number,
  guiY: number,
  tileWidth: number,
  tileHeight: number
): MapPoint => {
  const adjustedX = guiX - (tileWidth >> 1);
  const denominator = tileWidth * tileHeight;
  if (denominator === 0) return { x: 0, y: 0 };
  return {
    x: Math.floor((adjustedX * tileHeight + guiY * tileWidth) / denominator),
    y: Math.floor((guiY * tileWidth - adjustedX * tileHeight) / denominator),
  };
};

/**
 * Project one authoritative tile into the browser 2D GUI coordinate space.
 *
 * Freeciv-web's 2D renderer stores tiles in the same x/y grid that it passes
 * to map_to_gui_pos(). The native/logical conversion helpers above are still
 * used by topology and wrapping code, but must not be inserted into this
 * rendering path.
 *
 * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/2dcanvas/mapview_common.js:81-96,243-249
 */
export const nativeToGuiPosition = (
  nativeX: number,
  nativeY: number,
  geometry: MapGeometry,
  tileWidth: number,
  tileHeight: number
): MapPoint => {
  void geometry;
  return mapToGuiPosition(nativeX, nativeY, tileWidth, tileHeight);
};

/** Convert canvas GUI coordinates back to the tile grid used by freeciv-web. */
export const guiToNativePosition = (
  guiX: number,
  guiY: number,
  geometry: MapGeometry,
  tileWidth: number,
  tileHeight: number
): MapPoint => {
  void geometry;
  return guiToMapPosition(guiX, guiY, tileWidth, tileHeight);
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
  const geometry = createMapGeometry(nativeWidth, nativeHeight, topologyId);
  const native = mapToNativePosition(mapX, mapY, nativeWidth, geometry.isIsometric);
  if ((wrapId & 1) !== 0) native.x = wrap(native.x, nativeWidth);
  if ((wrapId & 2) !== 0) native.y = wrap(native.y, nativeHeight);
  return nativeToMapPosition(native.x, native.y, nativeWidth, geometry.isIsometric);
};

/**
 * Apply one freeciv-web map direction to the browser tile grid.
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
  void topologyId;
  const candidate = { x: nativeX + mapDx, y: nativeY + mapDy };

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
