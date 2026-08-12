/**
 * @module client/components/GameUI/minimapGeometry
 * Overview sizing and camera-outline geometry using the shared map projection.
 *
 * The minimap base follows freeciv-web's rectangular overview raster: each
 * map-coordinate tile occupies one rectangular cell. The camera footprint is
 * the exception: GUI corners are converted through the active map projection
 * and drawn as a polygon, so an ISO viewport remains a diamond.
 *
 * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/overview.js:139-158,233-275,387-400
 * @reference reference/freeciv/client/overview_common.c:52-111,322-374,450-483
 * @reference reference/freeciv/common/world_object.h:52-60
 */
import type { MapViewport } from '../../types';
import { guiToMapPosition, isIsometricTopology } from '../Canvas2D/mapTopologyGeometry';

export const MIN_OVERVIEW_WIDTH = 200;
export const MAX_OVERVIEW_WIDTH = 300;
export const MAX_OVERVIEW_HEIGHT = 300;
export const VIEWPORT_OUTLINE_COLOR = 'rgb(200,200,255)';
export const VIEWPORT_OUTLINE_WIDTH = 1;

export interface MinimapLayout {
  /** Rectangular map-cell scale used to size the overview canvas. */
  tileSize: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  /** Rectangular overview coordinate dimensions. */
  coordinateWidth: number;
  coordinateHeight: number;
}

export interface MinimapPoint {
  x: number;
  y: number;
}

const wrap = (value: number, range: number): number => ((value % range) + range) % range;

const axisOffsets = (enabled: boolean): number[] => (enabled ? [0, 1, -1] : [0]);

const getOverviewWrapTranslations = (
  nativeWidth: number,
  nativeHeight: number,
  wrapId: number
): MinimapPoint[] => {
  return axisOffsets((wrapId & 1) !== 0).flatMap(xOffset =>
    axisOffsets((wrapId & 2) !== 0).map(yOffset => ({
      x: xOffset * nativeWidth,
      y: yOffset * nativeHeight,
    }))
  );
};

const guiToOverviewMapPosition = (
  guiX: number,
  guiY: number,
  tileWidth: number,
  tileHeight: number,
  topologyId: number
): MinimapPoint => {
  if (isIsometricTopology(topologyId)) {
    return guiToMapPosition(guiX, guiY, tileWidth, tileHeight);
  }
  return {
    x: tileWidth ? Math.floor(guiX / tileWidth) : 0,
    y: tileHeight ? Math.floor(guiY / tileHeight) : 0,
  };
};

/**
 * Size a rectangular overview in map-coordinate space.
 *
 * Freeciv-web's overview raster does not draw the ISO sprite footprint. It
 * allocates one rectangular cell for each map-coordinate tile and scales the
 * complete raster into the overview bounds.
 */
export const getMinimapLayout = (nativeWidth: number, nativeHeight: number): MinimapLayout => {
  if (nativeWidth <= 0 || nativeHeight <= 0) {
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

  const coordinateWidth = nativeWidth;
  const coordinateHeight = nativeHeight;
  let tileSize = 1;
  while (tileSize * coordinateWidth < MIN_OVERVIEW_WIDTH) {
    tileSize += 1;
  }

  const scale = Math.min(
    tileSize,
    MAX_OVERVIEW_WIDTH / coordinateWidth,
    MAX_OVERVIEW_HEIGHT / coordinateHeight
  );
  const scaleX = scale;
  const scaleY = scale;
  const width = Math.floor(scaleX * coordinateWidth);
  const height = Math.floor(scaleY * coordinateHeight);
  return {
    tileSize: scale,
    width,
    height,
    scaleX,
    scaleY,
    coordinateWidth,
    coordinateHeight,
  };
};

/** Place one native tile in the rectangular overview raster. */
export const nativeToMinimapPosition = (nativeX: number, nativeY: number): MinimapPoint => ({
  x: nativeX,
  y: nativeY,
});

/**
 * Return the top-left pixel origins for every visible copy of one tile.
 * Wrapped copies follow the rectangular overview's map-axis periods.
 */
export const getMinimapTileOrigins = (
  nativeX: number,
  nativeY: number,
  nativeWidth: number,
  nativeHeight: number,
  wrapId: number,
  layout: MinimapLayout
): MinimapPoint[] => {
  const cell = nativeToMinimapPosition(nativeX, nativeY);

  return getOverviewWrapTranslations(nativeWidth, nativeHeight, wrapId).map(translation => ({
    x: (cell.x + translation.x) * layout.scaleX,
    y: (cell.y + translation.y) * layout.scaleY,
  }));
};

/** Return the pixel center of the displayed overview cell for a native tile. */
export const nativeToMinimapPixelPosition = (
  nativeX: number,
  nativeY: number,
  layout: MinimapLayout
): MinimapPoint => {
  const cell = nativeToMinimapPosition(nativeX, nativeY);
  return {
    x: (cell.x + 0.5) * layout.scaleX,
    y: (cell.y + 0.5) * layout.scaleY,
  };
};

/** Resolve a natural/display overview position back to native tile storage. */
export const minimapPositionToNative = (
  overviewX: number,
  overviewY: number,
  nativeWidth: number,
  nativeHeight: number,
  wrapId: number
): MinimapPoint => {
  let x = Math.floor(overviewX);
  let y = Math.floor(overviewY);
  if ((wrapId & 1) !== 0) x = wrap(x, nativeWidth);
  if ((wrapId & 2) !== 0) y = wrap(y, nativeHeight);
  return {
    x: Math.max(0, Math.min(nativeWidth - 1, x)),
    y: Math.max(0, Math.min(nativeHeight - 1, y)),
  };
};

/** Mirror overview_clicked() through the rectangular overview scale. */
export const minimapPointToMapTile = (
  x: number,
  y: number,
  nativeWidth: number,
  nativeHeight: number,
  layout: MinimapLayout,
  wrapId = 0
): MinimapPoint =>
  minimapPositionToNative(
    (x * layout.coordinateWidth) / layout.width,
    (y * layout.coordinateHeight) / layout.height,
    nativeWidth,
    nativeHeight,
    wrapId
  );

/** Mirror gui_to_map_pos(), including its half-tile X origin adjustment. */
export const guiToMapPos = (
  guiX: number,
  guiY: number,
  tileWidth: number,
  tileHeight: number
): MinimapPoint => guiToMapPosition(guiX, guiY, tileWidth, tileHeight);

/**
 * Return the base viewport footprint plus Freeciv's explicit +/- map copies.
 * The canvas clips copies outside the overview bounds.
 */
export const getMinimapViewportPolygons = (
  viewport: MapViewport,
  nativeWidth: number,
  nativeHeight: number,
  wrapId: number,
  layout: MinimapLayout,
  tileWidth: number,
  tileHeight: number,
  topologyId = 0
): MinimapPoint[][] => {
  if (!nativeWidth || !nativeHeight || !layout.width || !layout.height) return [];

  const mapCorners = [
    guiToOverviewMapPosition(viewport.x, viewport.y, tileWidth, tileHeight, topologyId),
    guiToOverviewMapPosition(
      viewport.x + viewport.width,
      viewport.y,
      tileWidth,
      tileHeight,
      topologyId
    ),
    guiToOverviewMapPosition(
      viewport.x + viewport.width,
      viewport.y + viewport.height,
      tileWidth,
      tileHeight,
      topologyId
    ),
    guiToOverviewMapPosition(
      viewport.x,
      viewport.y + viewport.height,
      tileWidth,
      tileHeight,
      topologyId
    ),
  ];
  const translations = getOverviewWrapTranslations(nativeWidth, nativeHeight, wrapId);

  return translations.map(translation =>
    mapCorners.map(point => ({
      x: (point.x + translation.x) * layout.scaleX,
      y: (point.y + translation.y) * layout.scaleY,
    }))
  );
};
