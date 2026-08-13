/**
 * @module client/components/GameUI/Minimap
 * Freeciv-compatible overview map with an independently refreshed viewport overlay.
 * The base retains freeciv-web's square palette raster and is presented once
 * through the selected uniform 2x1 physical map transform.
 *
 * @reference reference/freeciv-web/freeciv-web/src/main/webapp/javascript/overview.js:20-24,50-119,233-320,459-474
 * @reference reference/freeciv/client/overview_common.c:324-374,408-483
 */
import React, { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useGameStore } from '../../store/gameStore';
import { getMapRenderViewport, subscribeMapRenderViewport } from '../Canvas2D/mapRenderViewport';
import { getMapRenderTileSize, subscribeMapRenderTileSize } from '../Canvas2D/mapRenderMetrics';
import { HudPanel } from './HudPanel';
import { getMinimapCellAppearance, MINIMAP_COLORS } from './minimapVisibility';
import {
  getMinimapLayout,
  getMinimapSourceTileOrigins,
  getMinimapViewportPolygons,
  minimapPointToMapTile,
  VIEWPORT_OUTLINE_COLOR,
} from './minimapGeometry';

const TILE_COLORS: Record<string, string> = {
  // C2C3 terrain.ruleset overview palette. The reference overview receives
  // these values from the terrain catalogue instead of using sprite colors.
  inaccessible: '#191919',
  lake: '#2e78b6',
  ocean: '#002e89',
  deep_ocean: '#002181',
  coast: '#002e89',
  arctic: '#e8e8e8',
  grassland: '#0b8a04',
  plains: '#7a9c2e',
  forest: '#2b6b13',
  jungle: '#379c26',
  hills: '#186105',
  hill: '#186105',
  mountains: '#817f76',
  mountain: '#817f76',
  desert: '#d6b96a',
  tundra: '#bcbcbc',
  swamp: '#305561',
};

const terrainColor = (terrain: string | undefined): string => {
  const normalized = terrain?.toLowerCase() ?? 'unknown';
  return TILE_COLORS[normalized] ?? (normalized === 'unknown' ? MINIMAP_COLORS.unknown : '#475569');
};

export const Minimap: React.FC = () => {
  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);
  const dragMovedRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const baseFrameRef = useRef<number | null>(null);
  const overlayFrameRef = useRef<number | null>(null);
  const map = useGameStore(state => state.map);
  const viewport = useGameStore(state => state.viewport);
  const activeRenderViewport = useSyncExternalStore(
    subscribeMapRenderViewport,
    getMapRenderViewport,
    getMapRenderViewport
  );
  const units = useGameStore(state => state.units);
  const cities = useGameStore(state => state.cities);
  const players = useGameStore(state => state.players);
  const currentPlayerId = useGameStore(state => state.currentPlayerId);
  const selectedCityId = useGameStore(state => state.selectedCityId);
  const selectedUnitId = useGameStore(state => state.selectedUnitId);
  const tileSize = useSyncExternalStore(
    subscribeMapRenderTileSize,
    getMapRenderTileSize,
    getMapRenderTileSize
  );
  const nativeWidth = map.xsize ?? map.width;
  const nativeHeight = map.ysize ?? map.height;
  const topologyId = map.topology_id ?? 0;
  const wrapId = map.wrap_id ?? 0;
  const layout = getMinimapLayout(nativeWidth ?? 0, nativeHeight ?? 0, topologyId);
  const displayedViewport = activeRenderViewport ?? viewport;

  const drawBase = useCallback(() => {
    const canvas = baseCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    context.clearRect(0, 0, layout.width, layout.height);
    context.fillStyle = '#000000';
    context.fillRect(0, 0, layout.width, layout.height);
    if (!nativeWidth || !nativeHeight) return;

    const sourceCanvas = sourceCanvasRef.current ?? document.createElement('canvas');
    sourceCanvasRef.current = sourceCanvas;
    const sourceWidth = layout.sourceWidth;
    const sourceHeight = layout.sourceHeight;
    sourceCanvas.width = sourceWidth;
    sourceCanvas.height = sourceHeight;
    const sourceContext = sourceCanvas.getContext('2d');
    if (!sourceContext || !sourceWidth || !sourceHeight) return;
    sourceContext.imageSmoothingEnabled = false;
    sourceContext.clearRect(0, 0, sourceWidth, sourceHeight);
    sourceContext.fillStyle = '#000000';
    sourceContext.fillRect(0, 0, sourceWidth, sourceHeight);

    const tiles = Object.values(map.tiles);
    const citiesByCoordinate = new Map(
      Object.values(cities).map(city => [`${city.x},${city.y}`, city] as const)
    );
    const unitsByCoordinate = new Map<string, (typeof units)[string]>();
    for (const unit of Object.values(units)) {
      const key = `${unit.x},${unit.y}`;
      if (!unitsByCoordinate.has(key)) unitsByCoordinate.set(key, unit);
    }

    for (const tile of tiles) {
      const origins = getMinimapSourceTileOrigins(
        tile.x,
        tile.y,
        nativeWidth,
        nativeHeight,
        wrapId,
        layout
      );
      for (const origin of origins) {
        const city = citiesByCoordinate.get(`${tile.x},${tile.y}`);
        const unit = city ? undefined : unitsByCoordinate.get(`${tile.x},${tile.y}`);
        const appearance = getMinimapCellAppearance(
          tile,
          terrainColor(tile.terrain),
          currentPlayerId,
          tile.owner ? players[tile.owner]?.color : undefined,
          city
            ? { kind: 'city', ownerId: city.playerId }
            : unit
              ? {
                  kind: 'unit',
                  ownerId: unit.playerId,
                  ownerColor: players[unit.playerId]?.color,
                }
              : undefined
        );
        sourceContext.fillStyle = appearance.color;
        sourceContext.fillRect(origin.x, origin.y, layout.tileSize, layout.tileSize);
      }
    }
    // Freeciv-web leaves the overview image at the browser's default filtered
    // image-scaling behavior; the source raster itself remains unsmoothed.
    context.imageSmoothingEnabled = true;
    context.drawImage(
      sourceCanvas,
      0,
      0,
      sourceWidth,
      sourceHeight,
      0,
      0,
      layout.width,
      layout.height
    );
  }, [
    cities,
    currentPlayerId,
    layout,
    map.tiles,
    nativeHeight,
    nativeWidth,
    players,
    wrapId,
    units,
  ]);

  const drawOverlay = useCallback(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    context.clearRect(0, 0, layout.width, layout.height);
    if (!nativeWidth || !nativeHeight) return;
    const polygons = getMinimapViewportPolygons(
      displayedViewport,
      nativeWidth,
      nativeHeight,
      wrapId,
      layout,
      tileSize.width,
      tileSize.height,
      topologyId
    );
    context.strokeStyle = VIEWPORT_OUTLINE_COLOR;
    // One device pixel matches Freeciv's LINE_NORMAL at the final overview
    // raster size; all geometry above is already in displayed pixels.
    context.lineWidth = 1;
    context.beginPath();
    for (const polygon of polygons) {
      context.moveTo(polygon[0].x, polygon[0].y);
      for (let index = 1; index < polygon.length; index += 1) {
        context.lineTo(polygon[index].x, polygon[index].y);
      }
      context.lineTo(polygon[0].x, polygon[0].y);
    }
    context.stroke();
  }, [
    layout,
    nativeHeight,
    nativeWidth,
    tileSize.height,
    tileSize.width,
    topologyId,
    displayedViewport,
    wrapId,
  ]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      baseFrameRef.current = null;
      drawBase();
    });
    baseFrameRef.current = frameId;
    return () => {
      window.cancelAnimationFrame(frameId);
      if (baseFrameRef.current === frameId) baseFrameRef.current = null;
    };
  }, [drawBase]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      overlayFrameRef.current = null;
      drawOverlay();
    });
    overlayFrameRef.current = frameId;
    return () => {
      window.cancelAnimationFrame(frameId);
      if (overlayFrameRef.current === frameId) overlayFrameRef.current = null;
    };
  }, [drawOverlay]);

  const centerFromPointer = (
    clientX: number,
    clientY: number,
    source: 'minimap-click' | 'minimap-drag'
  ) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas || !nativeWidth || !nativeHeight || !layout.width || !layout.height) return;
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
    const rect = canvas.getBoundingClientRect();
    const localX = ((clientX - rect.left) / (rect.width || layout.width)) * layout.width;
    const localY = ((clientY - rect.top) / (rect.height || layout.height)) * layout.height;
    const point = minimapPointToMapTile(
      localX,
      localY,
      nativeWidth,
      nativeHeight,
      layout,
      topologyId,
      wrapId
    );
    document.dispatchEvent(
      new CustomEvent('center-map-on-tile', {
        detail: {
          x: Math.max(0, Math.min(nativeWidth - 1, point.x)),
          y: Math.max(0, Math.min(nativeHeight - 1, point.y)),
          source,
        },
      })
    );
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = true;
    dragMovedRef.current = false;
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draggingRef.current) return;

    if (
      !dragMovedRef.current &&
      Math.hypot(event.clientX - dragStartRef.current.x, event.clientY - dragStartRef.current.y) <=
        2
    ) {
      return;
    }

    dragMovedRef.current = true;
    centerFromPointer(event.clientX, event.clientY, 'minimap-drag');
  };
  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (draggingRef.current && dragMovedRef.current) {
      centerFromPointer(event.clientX, event.clientY, 'minimap-drag');
    }
    draggingRef.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const selectedCity = selectedCityId ? cities[selectedCityId] : undefined;
  const selectedUnit = selectedUnitId ? units[selectedUnitId] : undefined;
  const selectionLabel = selectedCity
    ? `, selected city ${selectedCity.name}`
    : selectedUnit
      ? `, selected unit ${selectedUnit.unitTypeId.replaceAll('_', ' ')}`
      : '';
  const canvasStyle = { width: layout.width, height: layout.height };

  return (
    <HudPanel className="hidden overflow-hidden p-1.5 sm:block">
      <div className="relative" style={canvasStyle}>
        <canvas
          ref={baseCanvasRef}
          width={layout.width}
          height={layout.height}
          aria-hidden="true"
          className="block rounded-md"
          style={canvasStyle}
        />
        <canvas
          ref={overlayCanvasRef}
          width={layout.width}
          height={layout.height}
          onClick={event => {
            // Pointer dragging already sent the final drag position on
            // pointerup. Browsers still synthesize a click afterward; do not
            // turn that release into a second discrete center action.
            if (dragMovedRef.current) {
              dragMovedRef.current = false;
              return;
            }
            centerFromPointer(event.clientX, event.clientY, 'minimap-click');
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          aria-label={`Minimap overview${selectionLabel}`}
          className="absolute inset-0 block cursor-crosshair touch-none rounded-md"
          style={canvasStyle}
        />
      </div>
    </HudPanel>
  );
};
