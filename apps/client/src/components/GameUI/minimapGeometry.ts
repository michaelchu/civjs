/**
 * @module client/components/GameUI/minimapGeometry
 * Freeciv-web-compatible overview sizing and camera-outline geometry.
 *
 * @reference reference/freeciv-web/javascript/overview.js:20-24,50-119,233-320,459-474
 * @reference reference/freeciv-web/javascript/2dcanvas/mapview_common.js:253-293,608-613
 * @reference reference/freeciv/client/overview_common.c:324-374,408-483
 */
import type { MapViewport } from '../../types';
import {
  mapToNativePosition,
  nativeAxisMapPeriod,
  nativeToMapPosition,
} from '../Canvas2D/mapTopologyGeometry';

export const MIN_OVERVIEW_WIDTH = 200;
export const MAX_OVERVIEW_WIDTH = 300;
export const MAX_OVERVIEW_HEIGHT = 300;
export const VIEWPORT_OUTLINE_COLOR = 'rgb(200,200,255)';
export const VIEWPORT_OUTLINE_WIDTH = 1;

export interface MinimapLayout {
  tileSize: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  coordinateWidth: number;
  coordinateHeight: number;
}

export interface MinimapPoint {
  x: number;
  y: number;
}

const wrap = (value: number, range: number): number => ((value % range) + range) % range;

const isIsometricTopology = (topologyId: number): boolean => (topologyId & 4) !== 0;

/** Size a centered logical overview, transposed for ISO landscape display. */
export const getMinimapLayout = (
  mapWidth: number,
  mapHeight: number,
  topologyId = 0
): MinimapLayout => {
  if (mapWidth <= 0 || mapHeight <= 0) {
    return {
      tileSize: 0,
      width: 0,
      height: 0,
      scaleX: 0,
      scaleY: 0,
      coordinateWidth: 0,
      coordinateHeight: 0,
    };
  }

  const isIsometric = isIsometricTopology(topologyId);
  const coordinateWidth = isIsometric ? mapHeight : mapWidth;
  const coordinateHeight = isIsometric ? mapWidth : mapHeight;
  let tileSize = 1;
  while (tileSize * coordinateWidth < MIN_OVERVIEW_WIDTH) tileSize += 1;

  const scale = Math.min(
    tileSize,
    MAX_OVERVIEW_WIDTH / coordinateWidth,
    MAX_OVERVIEW_HEIGHT / coordinateHeight
  );
  const width = Math.floor(scale * coordinateWidth);
  const height = Math.floor(scale * coordinateHeight);
  return {
    tileSize: scale,
    width,
    height,
    scaleX: scale,
    scaleY: scale,
    coordinateWidth,
    coordinateHeight,
  };
};

const axisOffsets = (enabled: boolean): number[] => (enabled ? [0, 1, -1] : [0]);

const getLogicalWrapTranslations = (
  mapWidth: number,
  mapHeight: number,
  topologyId: number,
  wrapId: number
): MinimapPoint[] => {
  const xPeriod = nativeAxisMapPeriod('x', mapWidth, mapHeight, topologyId);
  const yPeriod = nativeAxisMapPeriod('y', mapWidth, mapHeight, topologyId);
  return axisOffsets((wrapId & 1) !== 0).flatMap(xOffset =>
    axisOffsets((wrapId & 2) !== 0).map(yOffset => ({
      x: xOffset * xPeriod.x + yOffset * yPeriod.x,
      y: xOffset * xPeriod.y + yOffset * yPeriod.y,
    }))
  );
};

const getLogicalOverviewOrigin = (
  mapWidth: number,
  mapHeight: number,
  topologyId: number
): MinimapPoint => {
  if (!isIsometricTopology(topologyId)) return { x: 0, y: 0 };
  const nativeCenter = nativeToMapPosition(
    Math.floor(mapWidth / 2),
    Math.floor(mapHeight / 2),
    mapWidth,
    true
  );
  return {
    x: nativeCenter.x - Math.floor(mapWidth / 2),
    y: nativeCenter.y - Math.floor(mapHeight / 2),
  };
};

const overviewCellToDisplay = (
  overviewX: number,
  overviewY: number,
  mapHeight: number,
  topologyId: number
): MinimapPoint =>
  isIsometricTopology(topologyId)
    ? { x: mapHeight - 1 - overviewY, y: overviewX }
    : { x: overviewX, y: overviewY };

const displayCellToOverview = (
  displayX: number,
  displayY: number,
  mapHeight: number,
  topologyId: number
): MinimapPoint =>
  isIsometricTopology(topologyId)
    ? { x: displayY, y: mapHeight - 1 - displayX }
    : { x: displayX, y: displayY };

const overviewPointToDisplay = (
  overviewX: number,
  overviewY: number,
  mapHeight: number,
  topologyId: number
): MinimapPoint =>
  isIsometricTopology(topologyId)
    ? { x: mapHeight - overviewY, y: overviewX }
    : { x: overviewX, y: overviewY };

/** Place one native tile in the centered, displayed overview orientation. */
export const nativeToMinimapPosition = (
  nativeX: number,
  nativeY: number,
  mapWidth: number,
  mapHeight: number,
  topologyId: number,
  wrapId: number
): MinimapPoint => {
  const logical = nativeToMapPosition(nativeX, nativeY, mapWidth, isIsometricTopology(topologyId));
  const origin = getLogicalOverviewOrigin(mapWidth, mapHeight, topologyId);
  for (const translation of getLogicalWrapTranslations(mapWidth, mapHeight, topologyId, wrapId)) {
    const x = logical.x + translation.x - origin.x;
    const y = logical.y + translation.y - origin.y;
    if (x >= 0 && x < mapWidth && y >= 0 && y < mapHeight) {
      return overviewCellToDisplay(x, y, mapHeight, topologyId);
    }
  }
  return overviewCellToDisplay(logical.x - origin.x, logical.y - origin.y, mapHeight, topologyId);
};

/** Resolve a displayed overview position back to CivJS native tile storage. */
export const minimapPositionToNative = (
  overviewX: number,
  overviewY: number,
  mapWidth: number,
  mapHeight: number,
  topologyId: number,
  wrapId: number
): MinimapPoint => {
  const overview = displayCellToOverview(
    Math.floor(overviewX),
    Math.floor(overviewY),
    mapHeight,
    topologyId
  );
  const origin = getLogicalOverviewOrigin(mapWidth, mapHeight, topologyId);
  const native = mapToNativePosition(
    overview.x + origin.x,
    overview.y + origin.y,
    mapWidth,
    isIsometricTopology(topologyId)
  );
  let { x, y } = native;
  if ((wrapId & 1) !== 0) x = wrap(x, mapWidth);
  if ((wrapId & 2) !== 0) y = wrap(y, mapHeight);
  return {
    x: Math.max(0, Math.min(mapWidth - 1, x)),
    y: Math.max(0, Math.min(mapHeight - 1, y)),
  };
};

/** Mirror overview_clicked() through the shared, aspect-preserving overview scale. */
export const minimapPointToMapTile = (
  x: number,
  y: number,
  mapWidth: number,
  mapHeight: number,
  layout: MinimapLayout,
  topologyId = 0,
  wrapId = 0
): MinimapPoint =>
  minimapPositionToNative(
    (x * layout.coordinateWidth) / layout.width,
    (y * layout.coordinateHeight) / layout.height,
    mapWidth,
    mapHeight,
    topologyId,
    wrapId
  );

/** Mirror gui_to_map_pos(), including its half-tile X origin adjustment. */
export const guiToMapPos = (
  guiX: number,
  guiY: number,
  tileWidth: number,
  tileHeight: number
): MinimapPoint => {
  const adjustedX = guiX - (tileWidth >> 1);
  return {
    x: Math.floor((adjustedX * tileHeight + guiY * tileWidth) / (tileWidth * tileHeight)),
    y: Math.floor((guiY * tileWidth - adjustedX * tileHeight) / (tileWidth * tileHeight)),
  };
};

/**
 * Return the base viewport footprint plus Freeciv's explicit +/- map copies.
 * The browser canvas clips copies outside the overview bounds.
 */
export const getMinimapViewportPolygons = (
  viewport: MapViewport,
  mapWidth: number,
  mapHeight: number,
  wrapId: number,
  layout: MinimapLayout,
  tileWidth: number,
  tileHeight: number,
  topologyId = 0
): MinimapPoint[][] => {
  if (!mapWidth || !mapHeight || !layout.width || !layout.height) return [];

  const mapCorners = [
    guiToMapPos(viewport.x, viewport.y, tileWidth, tileHeight),
    guiToMapPos(viewport.x + viewport.width, viewport.y, tileWidth, tileHeight),
    guiToMapPos(viewport.x + viewport.width, viewport.y + viewport.height, tileWidth, tileHeight),
    guiToMapPos(viewport.x, viewport.y + viewport.height, tileWidth, tileHeight),
  ];
  const origin = getLogicalOverviewOrigin(mapWidth, mapHeight, topologyId);

  return getLogicalWrapTranslations(mapWidth, mapHeight, topologyId, wrapId).map(translation =>
    mapCorners.map(point => {
      const display = overviewPointToDisplay(
        point.x + translation.x - origin.x,
        point.y + translation.y - origin.y,
        mapHeight,
        topologyId
      );
      return {
        x: display.x * layout.scaleX,
        y: display.y * layout.scaleY,
      };
    })
  );
};
