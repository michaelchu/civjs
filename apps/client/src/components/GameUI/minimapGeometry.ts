/**
 * @module client/components/GameUI/minimapGeometry
 * Overview sizing, pointer inversion, and camera-outline geometry.
 *
 * C2C3 uses Freeciv's natural overview raster: each native tile occupies a
 * 2x1 cell and odd native rows are offset by one X unit. Keeping that mapping
 * shared by terrain, markers, clicks, wrapping, and the viewport outline
 * prevents browser scaling from changing the map's orientation.
 *
 * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/overview.js:50-54,104-109,139-158,194-275,387-400
 * @reference reference/freeciv/client/overview_common.h:27-33
 * @reference reference/freeciv/client/overview_common.c:450-483
 * @reference reference/freeciv/common/world_object.h:54-60
 */
import type { MapViewport } from '../../types';
import {
  createMapGeometry,
  guiToMapPosition,
  guiToMapPositionContinuous,
  isIsometricTopology,
  mapToDisplayPosition,
  usesNativeLogicalProjection,
} from '../Canvas2D/mapTopologyGeometry';

export const MIN_OVERVIEW_WIDTH = 200;
export const MAX_OVERVIEW_WIDTH = 300;
export const MAX_OVERVIEW_HEIGHT = 300;
export const VIEWPORT_OUTLINE_COLOR = 'rgb(200,200,255)';
export const VIEWPORT_OUTLINE_WIDTH = 1;

export interface MinimapLayout {
  /** Integer pixels per natural overview coordinate in the source raster. */
  tileSize: number;
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
  /** Pixels per physical overview coordinate; equal unless integer rounding is unavoidable. */
  scaleX: number;
  scaleY: number;
  /** Physical overview extents. ISO map cells occupy two X units and one Y unit. */
  coordinateWidth: number;
  coordinateHeight: number;
}

export interface MinimapPoint {
  x: number;
  y: number;
}

const wrap = (value: number, range: number): number => ((value % range) + range) % range;

const axisOffsets = (enabled: boolean): number[] => (enabled ? [0, 1, -1] : [0]);

const greatestCommonDivisor = (left: number, right: number): number => {
  let a = Math.abs(Math.trunc(left));
  let b = Math.abs(Math.trunc(right));
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return Math.max(1, a);
};

/** Freeciv OVERVIEW_TILE_WIDTH / OVERVIEW_TILE_HEIGHT. */
export const getMinimapCellWidth = (topologyId: number): number =>
  isIsometricTopology(topologyId) ? 2 : 1;

/**
 * Freeciv clips half a natural ISO cell from each horizontal edge when X
 * wrapping is disabled. Every overview coordinate is shifted left by the
 * same unit, and the inverse adds it back before NATURAL_TO_MAP_POS.
 */
const getNonWrappingIsoXShift = (topologyId: number, wrapId: number): number =>
  usesNativeLogicalProjection(topologyId) && (wrapId & 1) === 0 ? -1 : 0;

const getOverviewWrapTranslations = (
  nativeWidth: number,
  nativeHeight: number,
  topologyId: number,
  wrapId: number
): MinimapPoint[] =>
  axisOffsets((wrapId & 1) !== 0).flatMap(xOffset =>
    axisOffsets((wrapId & 2) !== 0).map(yOffset => ({
      x: xOffset * nativeWidth * getMinimapCellWidth(topologyId),
      y: yOffset * nativeHeight,
    }))
  );

/** Freeciv gui_to_natural_pos() starts with this non-rounding GUI inverse. */
const guiToLogicalPositionContinuous = (
  guiX: number,
  guiY: number,
  tileWidth: number,
  tileHeight: number
): MinimapPoint => {
  const denominator = tileWidth * tileHeight;
  if (!denominator) return { x: 0, y: 0 };
  return {
    x: (guiX * tileHeight + guiY * tileWidth) / denominator,
    y: (guiY * tileWidth - guiX * tileHeight) / denominator,
  };
};

const guiToOverviewMapPosition = (
  guiX: number,
  guiY: number,
  tileWidth: number,
  tileHeight: number,
  topologyId: number
): MinimapPoint => {
  if (usesNativeLogicalProjection(topologyId)) {
    return guiToLogicalPositionContinuous(guiX, guiY, tileWidth, tileHeight);
  }
  if (isIsometricTopology(topologyId)) {
    // C Freeciv deliberately keeps these values fractional for the overview;
    // flooring here shifts the camera footprint up/left by half a map cell.
    return guiToMapPositionContinuous(guiX, guiY, tileWidth, tileHeight);
  }
  return {
    x: tileWidth ? guiX / tileWidth : 0,
    y: tileHeight ? guiY / tileHeight : 0,
  };
};

/** Fit integer canvas dimensions without changing the physical map aspect. */
const fitOverviewDimensions = (
  coordinateWidth: number,
  coordinateHeight: number,
  preferredScale: number
): { width: number; height: number } => {
  const preferredWidth = coordinateWidth * preferredScale;
  const preferredHeight = coordinateHeight * preferredScale;
  if (preferredWidth <= MAX_OVERVIEW_WIDTH && preferredHeight <= MAX_OVERVIEW_HEIGHT) {
    return { width: preferredWidth, height: preferredHeight };
  }

  const divisor = greatestCommonDivisor(coordinateWidth, coordinateHeight);
  const aspectWidth = coordinateWidth / divisor;
  const aspectHeight = coordinateHeight / divisor;
  const multiplier = Math.floor(
    Math.min(MAX_OVERVIEW_WIDTH / aspectWidth, MAX_OVERVIEW_HEIGHT / aspectHeight)
  );
  if (multiplier >= 1) {
    return { width: aspectWidth * multiplier, height: aspectHeight * multiplier };
  }

  const scale = Math.min(
    MAX_OVERVIEW_WIDTH / coordinateWidth,
    MAX_OVERVIEW_HEIGHT / coordinateHeight
  );
  return {
    width: Math.max(1, Math.round(coordinateWidth * scale)),
    height: Math.max(1, Math.round(coordinateHeight * scale)),
  };
};

/**
 * Size a natural-coordinate source palette and its displayed presentation.
 * Both axes use one physical scale; there is no post-raster axis stretch.
 */
export const getMinimapLayout = (
  nativeWidth: number,
  nativeHeight: number,
  topologyId = 0,
  wrapId = 0
): MinimapLayout => {
  if (nativeWidth <= 0 || nativeHeight <= 0) {
    return {
      tileSize: 0,
      sourceWidth: 0,
      sourceHeight: 0,
      width: 0,
      height: 0,
      scaleX: 0,
      scaleY: 0,
      coordinateWidth: 0,
      coordinateHeight: 0,
    };
  }

  const coordinateWidth =
    nativeWidth * getMinimapCellWidth(topologyId) + getNonWrappingIsoXShift(topologyId, wrapId);
  const coordinateHeight = nativeHeight;
  let preferredScale = 1;
  while (preferredScale * coordinateWidth < MIN_OVERVIEW_WIDTH) preferredScale += 1;
  let tileSize = 1;
  const sourceCoordinateWidth = usesNativeLogicalProjection(topologyId)
    ? coordinateWidth
    : nativeWidth;
  while (tileSize * sourceCoordinateWidth < MIN_OVERVIEW_WIDTH) tileSize += 1;
  const { width, height } = fitOverviewDimensions(
    coordinateWidth,
    coordinateHeight,
    preferredScale
  );

  return {
    tileSize,
    sourceWidth: tileSize * sourceCoordinateWidth,
    sourceHeight: tileSize * coordinateHeight,
    width,
    height,
    scaleX: width / coordinateWidth,
    scaleY: height / coordinateHeight,
    coordinateWidth,
    coordinateHeight,
  };
};

/** Place one native tile in Freeciv's natural overview coordinates. */
export const nativeToMinimapPosition = (
  nativeX: number,
  nativeY: number,
  topologyId = 0
): MinimapPoint => ({
  x:
    nativeX * getMinimapCellWidth(topologyId) +
    (usesNativeLogicalProjection(topologyId) ? nativeY & 1 : 0),
  y: nativeY,
});

/** Return displayed pixel origins for the base tile and wrapped map copies. */
export const getMinimapTileOrigins = (
  nativeX: number,
  nativeY: number,
  nativeWidth: number,
  nativeHeight: number,
  topologyId: number,
  wrapId: number,
  layout: MinimapLayout
): MinimapPoint[] => {
  const cell = nativeToMinimapPosition(nativeX, nativeY, topologyId);
  const xShift = getNonWrappingIsoXShift(topologyId, wrapId);
  return getOverviewWrapTranslations(nativeWidth, nativeHeight, topologyId, wrapId).map(
    translation => ({
      x: (cell.x + translation.x + xShift) * layout.scaleX,
      y: (cell.y + translation.y) * layout.scaleY,
    })
  );
};

/** Return natural source-raster origins, including wrapped seam copies. */
export const getMinimapSourceTileOrigins = (
  nativeX: number,
  nativeY: number,
  nativeWidth: number,
  nativeHeight: number,
  topologyId: number,
  wrapId: number,
  layout: MinimapLayout
): MinimapPoint[] => {
  // The square-ISO compatibility renderer retains freeciv-web's one-square
  // source bitmap and applies the 2:1 aspect only when displaying it. Native
  // ISO-hex instead paints Freeciv's staggered 2x1 natural raster directly.
  if (!usesNativeLogicalProjection(topologyId)) {
    return axisOffsets((wrapId & 1) !== 0).flatMap(xOffset =>
      axisOffsets((wrapId & 2) !== 0).map(yOffset => ({
        x: (nativeX + xOffset * nativeWidth) * layout.tileSize,
        y: (nativeY + yOffset * nativeHeight) * layout.tileSize,
      }))
    );
  }
  const cell = nativeToMinimapPosition(nativeX, nativeY, topologyId);
  const xShift = getNonWrappingIsoXShift(topologyId, wrapId);
  return getOverviewWrapTranslations(nativeWidth, nativeHeight, topologyId, wrapId).map(
    translation => ({
      x: (cell.x + translation.x + xShift) * layout.tileSize,
      y: (cell.y + translation.y) * layout.tileSize,
    })
  );
};

/** Return the displayed center of the terrain/marker cell for one map tile. */
export const nativeToMinimapPixelPosition = (
  nativeX: number,
  nativeY: number,
  layout: MinimapLayout,
  topologyId = 0,
  wrapId = 0
): MinimapPoint => {
  const cell = nativeToMinimapPosition(nativeX, nativeY, topologyId);
  return {
    x:
      (cell.x + getNonWrappingIsoXShift(topologyId, wrapId) + getMinimapCellWidth(topologyId) / 2) *
      layout.scaleX,
    y: (cell.y + 0.5) * layout.scaleY,
  };
};

/** Resolve a physical overview coordinate back to browser map-tile storage. */
export const minimapPositionToNative = (
  overviewX: number,
  overviewY: number,
  nativeWidth: number,
  nativeHeight: number,
  topologyId = 0,
  wrapId = 0
): MinimapPoint => {
  let y = Math.floor(overviewY);
  const naturalX = overviewX - getNonWrappingIsoXShift(topologyId, wrapId);
  let x = usesNativeLogicalProjection(topologyId)
    ? Math.floor((naturalX - (y & 1)) / 2)
    : Math.floor(naturalX / getMinimapCellWidth(topologyId));
  if ((wrapId & 1) !== 0) x = wrap(x, nativeWidth);
  if ((wrapId & 2) !== 0) y = wrap(y, nativeHeight);
  return {
    x: Math.max(0, Math.min(nativeWidth - 1, x)),
    y: Math.max(0, Math.min(nativeHeight - 1, y)),
  };
};

/** Mirror overview_clicked() through the same physical transform as the raster. */
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
    x / layout.scaleX,
    y / layout.scaleY,
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

/** Return the camera footprint and explicit +/- wrapped copies in display pixels. */
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
  let overviewCorners: MinimapPoint[];
  if (usesNativeLogicalProjection(topologyId)) {
    const center = guiToOverviewMapPosition(
      viewport.x + viewport.width / 2,
      viewport.y + viewport.height / 2,
      tileWidth,
      tileHeight,
      topologyId
    );
    const centerNatural = mapToDisplayPosition(
      center.x,
      center.y,
      createMapGeometry(nativeWidth, nativeHeight, topologyId)
    );
    // Keep CivJS's requested rotated ISO camera footprint. GUI tile centers
    // map half a natural Y unit below the center of Freeciv's 2x1 overview
    // cell, so remove that convention offset before anchoring the polygon.
    overviewCorners = mapCorners.map(point => ({
      x: centerNatural.x + 2 * (point.x - center.x),
      y: centerNatural.y - 0.5 + (point.y - center.y),
    }));
  } else if (isIsometricTopology(topologyId)) {
    overviewCorners = mapCorners.map(point => ({ x: point.x * 2, y: point.y }));
  } else {
    overviewCorners = mapCorners;
  }

  return getOverviewWrapTranslations(nativeWidth, nativeHeight, topologyId, wrapId).map(
    translation =>
      overviewCorners.map(point => ({
        x: (point.x + translation.x + getNonWrappingIsoXShift(topologyId, wrapId)) * layout.scaleX,
        y: (point.y + translation.y) * layout.scaleY,
      }))
  );
};
