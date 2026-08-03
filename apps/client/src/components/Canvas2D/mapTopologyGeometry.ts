/**
 * @module client/components/Canvas2D/mapTopologyGeometry
 * Freeciv isometric native/map conversion used at wrapped GUI seams.
 * @reference reference/freeciv-web/javascript/map.js:231-250
 * @reference reference/freeciv-web/javascript/2dcanvas/mapview_common.js:195-239
 */
export interface MapPoint {
  x: number;
  y: number;
}

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

export const mapToNativePosition = (
  mapX: number,
  mapY: number,
  nativeWidth: number,
  isIsometric: boolean
): MapPoint => {
  if (!isIsometric) return { x: mapX, y: mapY };
  const nativeY = mapX + mapY - nativeWidth;
  return {
    x: Math.floor((2 * mapX - nativeY - (nativeY & 1)) / 2),
    y: nativeY,
  };
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
  const isIsometric = (topologyId & 4) !== 0;
  const native = mapToNativePosition(mapX, mapY, nativeWidth, isIsometric);
  if ((wrapId & 1) !== 0) native.x = wrap(native.x, nativeWidth);
  if ((wrapId & 2) !== 0) native.y = wrap(native.y, nativeHeight);
  return nativeToMapPosition(native.x, native.y, nativeWidth, isIsometric);
};

/**
 * Apply one logical Freeciv map direction to CivJS's native rectangular tile storage.
 * @reference reference/freeciv-web/javascript/map.js:360-369
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
  const isIsometric = (topologyId & 4) !== 0;
  const logical = nativeToMapPosition(nativeX, nativeY, nativeWidth, isIsometric);
  const candidate = mapToNativePosition(
    logical.x + mapDx,
    logical.y + mapDy,
    nativeWidth,
    isIsometric
  );

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

export const nativeAxisMapPeriod = (
  axis: 'x' | 'y',
  nativeWidth: number,
  nativeHeight: number,
  topologyId: number
): MapPoint => {
  const isIsometric = (topologyId & 4) !== 0;
  const origin = nativeToMapPosition(0, 0, nativeWidth, isIsometric);
  const translated = nativeToMapPosition(
    axis === 'x' ? nativeWidth : 0,
    axis === 'y' ? nativeHeight : 0,
    nativeWidth,
    isIsometric
  );
  return { x: translated.x - origin.x, y: translated.y - origin.y };
};
