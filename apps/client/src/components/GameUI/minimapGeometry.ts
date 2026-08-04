/**
 * @module client/components/GameUI/minimapGeometry
 * Overview sizing and camera-outline geometry using the shared map projection.
 *
 * The minimap consumes Freeciv natural/display coordinates directly.  It does
 * not rotate ISO coordinates independently from the main canvas: native tiles
 * are projected once, then scaled into the overview surface. The camera
 * footprint is the exception: its GUI corners are projected through logical
 * map space so an ISO viewport remains a diamond.
 *
 * @reference reference/freeciv/client/overview_common.c:52-111,322-374,450-483
 * @reference reference/freeciv/common/world_object.h:52-60
 */
import type { MapViewport } from '../../types';
import {
  createMapGeometry,
  displayToNativePosition,
  guiToMapPosition,
  isIsometricTopology,
  nativeToMapPosition,
  nativeAxisDisplayPeriod,
  nativeToDisplayPosition,
  type MapGeometry,
} from '../Canvas2D/mapTopologyGeometry';

export const MIN_OVERVIEW_WIDTH = 200;
export const MAX_OVERVIEW_WIDTH = 300;
export const MAX_OVERVIEW_HEIGHT = 300;
export const VIEWPORT_OUTLINE_COLOR = 'rgb(200,200,255)';
export const VIEWPORT_OUTLINE_WIDTH = 1;

export interface MinimapLayout {
  /** Base square-tile scale used to size the overview canvas. */
  tileSize: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  /** Natural/display coordinate dimensions, never native packet dimensions. */
  coordinateWidth: number;
  coordinateHeight: number;
}

export interface MinimapPoint {
  x: number;
  y: number;
}

const wrap = (value: number, range: number): number => ((value % range) + range) % range;

const axisOffsets = (enabled: boolean): number[] => (enabled ? [0, 1, -1] : [0]);

const getLogicalWrapTranslations = (geometry: MapGeometry, wrapId: number): MinimapPoint[] => {
  const origin = nativeToMapPosition(0, 0, geometry.nativeWidth, geometry.isIsometric);
  const getAxisPeriod = (axis: 'x' | 'y'): MinimapPoint => {
    const translated = nativeToMapPosition(
      axis === 'x' ? geometry.nativeWidth : 0,
      axis === 'y' ? geometry.nativeHeight : 0,
      geometry.nativeWidth,
      geometry.isIsometric
    );
    return { x: translated.x - origin.x, y: translated.y - origin.y };
  };
  const xPeriod = getAxisPeriod('x');
  const yPeriod = getAxisPeriod('y');

  return axisOffsets((wrapId & 1) !== 0).flatMap(xOffset =>
    axisOffsets((wrapId & 2) !== 0).map(yOffset => ({
      x: xOffset * xPeriod.x + yOffset * yPeriod.x,
      y: xOffset * xPeriod.y + yOffset * yPeriod.y,
    }))
  );
};

const getLogicalOverviewOrigin = (geometry: MapGeometry): MinimapPoint => {
  if (!geometry.isIsometric) return { x: 0, y: 0 };
  const nativeCenter = nativeToMapPosition(
    Math.floor(geometry.nativeWidth / 2),
    Math.floor(geometry.nativeHeight / 2),
    geometry.nativeWidth,
    true
  );
  return {
    x: nativeCenter.x - Math.floor(geometry.nativeWidth / 2),
    y: nativeCenter.y - Math.floor(geometry.nativeHeight / 2),
  };
};

/** Project a logical ISO point into the overview's clockwise screen space. */
const logicalPointToMinimapPixel = (
  point: MinimapPoint,
  geometry: MapGeometry,
  layout: MinimapLayout
): MinimapPoint => {
  if (!geometry.isIsometric) {
    return { x: point.x * layout.scaleX, y: point.y * layout.scaleY };
  }

  // Rotate the logical map axes clockwise. The overview's square-tile raster
  // has native width/height proportions, so normalize the rotated logical
  // extents to the actual canvas dimensions.
  return {
    x: ((geometry.nativeHeight - point.y) / geometry.nativeHeight) * layout.width,
    y: (point.x / geometry.nativeWidth) * layout.height,
  };
};

/**
 * Size an overview in natural/display coordinates.
 *
 * ISO tiles occupy two horizontal natural units and one vertical natural
 * unit. Compressing the horizontal natural axis by half makes that footprint
 * render as one square tile while preserving the natural map orientation.
 */
export const getMinimapLayout = (
  nativeWidth: number,
  nativeHeight: number,
  topologyId = 0
): MinimapLayout => {
  const geometry = createMapGeometry(nativeWidth, nativeHeight, topologyId);
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

  const coordinateWidth = geometry.displayWidth;
  const coordinateHeight = geometry.displayHeight;
  const horizontalAspect = geometry.isIsometric ? 0.5 : 1;
  let tileSize = 1;
  while (tileSize * coordinateWidth * horizontalAspect < MIN_OVERVIEW_WIDTH) {
    tileSize += 1;
  }

  const scale = Math.min(
    tileSize,
    MAX_OVERVIEW_WIDTH / (coordinateWidth * horizontalAspect),
    MAX_OVERVIEW_HEIGHT / coordinateHeight
  );
  const scaleX = scale * horizontalAspect;
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

const getDisplayWrapTranslations = (geometry: MapGeometry, wrapId: number): MinimapPoint[] => {
  const xPeriod = nativeAxisDisplayPeriod('x', geometry);
  const yPeriod = nativeAxisDisplayPeriod('y', geometry);
  return axisOffsets((wrapId & 1) !== 0).flatMap(xOffset =>
    axisOffsets((wrapId & 2) !== 0).map(yOffset => ({
      x: xOffset * xPeriod.x + yOffset * yPeriod.x,
      y: xOffset * xPeriod.y + yOffset * yPeriod.y,
    }))
  );
};

/** Place one native tile in the shared natural/display overview coordinates. */
export const nativeToMinimapPosition = (
  nativeX: number,
  nativeY: number,
  nativeWidth: number,
  nativeHeight: number,
  topologyId: number
): MinimapPoint =>
  nativeToDisplayPosition(
    nativeX,
    nativeY,
    createMapGeometry(nativeWidth, nativeHeight, topologyId)
  );

/**
 * Return the top-left pixel origins for every visible copy of one tile.
 *
 * ISO natural rows alternate by one horizontal natural unit. On a wrapped
 * map, the last tile in an offset row can therefore cross the right seam;
 * drawing the translated copies keeps that half-tile visible on the left.
 */
export const getMinimapTileOrigins = (
  nativeX: number,
  nativeY: number,
  nativeWidth: number,
  nativeHeight: number,
  topologyId: number,
  wrapId: number,
  layout: MinimapLayout
): MinimapPoint[] => {
  const geometry = createMapGeometry(nativeWidth, nativeHeight, topologyId);
  const cell = nativeToDisplayPosition(nativeX, nativeY, geometry);

  return getDisplayWrapTranslations(geometry, wrapId).map(translation => ({
    x: (cell.x + translation.x) * layout.scaleX,
    y: (cell.y + translation.y) * layout.scaleY,
  }));
};

/** Return the pixel center of the displayed overview cell for a native tile. */
export const nativeToMinimapPixelPosition = (
  nativeX: number,
  nativeY: number,
  nativeWidth: number,
  nativeHeight: number,
  topologyId: number,
  layout: MinimapLayout
): MinimapPoint => {
  const cell = nativeToMinimapPosition(nativeX, nativeY, nativeWidth, nativeHeight, topologyId);
  return {
    // A native ISO tile spans two natural x coordinates. The marker belongs
    // at the center of that span; non-ISO tiles occupy one coordinate cell.
    x: (cell.x + (isIsometricTopology(topologyId) ? 1 : 0.5)) * layout.scaleX,
    y: (cell.y + 0.5) * layout.scaleY,
  };
};

/** Resolve a natural/display overview position back to native tile storage. */
export const minimapPositionToNative = (
  overviewX: number,
  overviewY: number,
  nativeWidth: number,
  nativeHeight: number,
  topologyId: number,
  wrapId: number
): MinimapPoint => {
  const geometry = createMapGeometry(nativeWidth, nativeHeight, topologyId);
  const native = displayToNativePosition(overviewX, overviewY, geometry);
  let { x, y } = native;
  if ((wrapId & 1) !== 0) x = wrap(x, nativeWidth);
  if ((wrapId & 2) !== 0) y = wrap(y, nativeHeight);
  return {
    x: Math.max(0, Math.min(nativeWidth - 1, x)),
    y: Math.max(0, Math.min(nativeHeight - 1, y)),
  };
};

/** Mirror overview_clicked() through the shared, aspect-preserving overview scale. */
export const minimapPointToMapTile = (
  x: number,
  y: number,
  nativeWidth: number,
  nativeHeight: number,
  layout: MinimapLayout,
  topologyId = 0,
  wrapId = 0
): MinimapPoint =>
  minimapPositionToNative(
    (x * layout.coordinateWidth) / layout.width,
    (y * layout.coordinateHeight) / layout.height,
    nativeWidth,
    nativeHeight,
    topologyId,
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

  const geometry = createMapGeometry(nativeWidth, nativeHeight, topologyId);
  const mapCorners = [
    guiToMapPosition(viewport.x, viewport.y, tileWidth, tileHeight),
    guiToMapPosition(viewport.x + viewport.width, viewport.y, tileWidth, tileHeight),
    guiToMapPosition(
      viewport.x + viewport.width,
      viewport.y + viewport.height,
      tileWidth,
      tileHeight
    ),
    guiToMapPosition(viewport.x, viewport.y + viewport.height, tileWidth, tileHeight),
  ];
  const origin = getLogicalOverviewOrigin(geometry);
  const translations = geometry.isIsometric
    ? getLogicalWrapTranslations(geometry, wrapId)
    : getDisplayWrapTranslations(geometry, wrapId);

  return translations.map(translation =>
    mapCorners.map(point =>
      logicalPointToMinimapPixel(
        {
          x: point.x + translation.x - origin.x,
          y: point.y + translation.y - origin.y,
        },
        geometry,
        layout
      )
    )
  );
};
