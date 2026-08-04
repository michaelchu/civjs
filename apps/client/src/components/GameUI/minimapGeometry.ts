/**
 * @module client/components/GameUI/minimapGeometry
 * Overview sizing and camera-outline geometry using the shared map projection.
 *
 * The minimap consumes Freeciv natural/display coordinates directly.  It does
 * not rotate ISO coordinates independently from the main canvas: native tiles
 * are projected once, then scaled into the overview surface.
 *
 * @reference reference/freeciv/client/overview_common.c:52-111,322-374,450-483
 * @reference reference/freeciv/common/world_object.h:52-60
 */
import type { MapViewport } from '../../types';
import {
  createMapGeometry,
  displayToNativePosition,
  guiToDisplayPosition,
  guiToMapPosition,
  isIsometricTopology,
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
  /** Horizontal natural/display scale used by the overview canvas. */
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

/**
 * Size an overview in natural/display coordinates.
 *
 * ISO natural coordinates have a 2:1 GUI aspect between their horizontal and
 * vertical axes, so the overview uses separate scales while retaining the
 * landscape projection used by the main canvas. Non-ISO maps retain the
 * existing square-cell sizing.
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
  const verticalAspect = geometry.isIsometric ? 0.5 : 1;
  let tileSize = 1;
  while (tileSize * coordinateWidth < MIN_OVERVIEW_WIDTH) tileSize += 1;

  const scale = Math.min(
    tileSize,
    MAX_OVERVIEW_WIDTH / coordinateWidth,
    MAX_OVERVIEW_HEIGHT / (coordinateHeight * verticalAspect)
  );
  const scaleX = scale;
  const scaleY = scale * verticalAspect;
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
  const displayCorners = [
    guiToDisplayPosition(viewport.x, viewport.y, geometry, tileWidth, tileHeight),
    guiToDisplayPosition(viewport.x + viewport.width, viewport.y, geometry, tileWidth, tileHeight),
    guiToDisplayPosition(
      viewport.x + viewport.width,
      viewport.y + viewport.height,
      geometry,
      tileWidth,
      tileHeight
    ),
    guiToDisplayPosition(viewport.x, viewport.y + viewport.height, geometry, tileWidth, tileHeight),
  ];

  return getDisplayWrapTranslations(geometry, wrapId).map(translation =>
    displayCorners.map(point => ({
      x: (point.x + translation.x) * layout.scaleX,
      y: (point.y + translation.y) * layout.scaleY,
    }))
  );
};
