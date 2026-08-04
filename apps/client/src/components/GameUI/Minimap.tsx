/**
 * @module client/components/GameUI/Minimap
 * Freeciv-web-compatible overview map with an independently refreshed viewport overlay.
 *
 * @reference reference/freeciv-web/javascript/overview.js:20-24,50-119,233-320,459-474
 * @reference reference/freeciv/client/overview_common.c:324-374,408-483
 */
import React, { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useGameStore } from '../../store/gameStore';
import { getMapRenderTileSize, subscribeMapRenderTileSize } from '../Canvas2D/mapRenderMetrics';
import { HudPanel } from './HudPanel';
import { isMinimapMarkerVisible } from './minimapVisibility';
import {
  getMinimapLayout,
  getMinimapViewportPolygons,
  minimapPointToMapTile,
  minimapPositionToNative,
  nativeToMinimapPixelPosition,
  VIEWPORT_OUTLINE_COLOR,
  VIEWPORT_OUTLINE_WIDTH,
} from './minimapGeometry';

const TILE_COLORS: Record<string, string> = {
  ocean: '#164e63',
  deep_ocean: '#164e63',
  coast: '#0e7490',
  grassland: '#3f7d4a',
  plains: '#78934e',
  forest: '#166534',
  jungle: '#14532d',
  hills: '#8b7355',
  hill: '#8b7355',
  mountains: '#64748b',
  mountain: '#64748b',
  desert: '#c49a58',
  tundra: '#94a3a8',
  arctic: '#cbd5e1',
  swamp: '#4d6b4a',
};

const terrainColor = (terrain: string | undefined): string => {
  const normalized = terrain?.toLowerCase() ?? 'unknown';
  return TILE_COLORS[normalized] ?? (normalized === 'unknown' ? '#000000' : '#475569');
};

const playerColor = (color: string | undefined, fallback: string): string => color || fallback;

export const Minimap: React.FC = () => {
  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);
  const dragMovedRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const baseFrameRef = useRef<number | null>(null);
  const overlayFrameRef = useRef<number | null>(null);
  const map = useGameStore(state => state.map);
  const viewport = useGameStore(state => state.viewport);
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
  const mapWidth = map.xsize ?? map.width;
  const mapHeight = map.ysize ?? map.height;
  const topologyId = map.topology_id ?? 0;
  const wrapId = map.wrap_id ?? 0;
  const layout = getMinimapLayout(mapWidth ?? 0, mapHeight ?? 0, topologyId);

  const drawBase = useCallback(() => {
    const canvas = baseCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    context.clearRect(0, 0, layout.width, layout.height);
    context.fillStyle = '#000000';
    context.fillRect(0, 0, layout.width, layout.height);
    if (!mapWidth || !mapHeight) return;

    const tiles = Object.values(map.tiles);
    const tilesByCoordinate = new Map(tiles.map(tile => [`${tile.x},${tile.y}`, tile]));
    const markerPosition = (x: number, y: number) =>
      nativeToMinimapPixelPosition(x, y, mapWidth, mapHeight, topologyId, wrapId, layout);
    for (let overviewY = 0; overviewY < layout.coordinateHeight; overviewY += 1) {
      for (let overviewX = 0; overviewX < layout.coordinateWidth; overviewX += 1) {
        const native = minimapPositionToNative(
          overviewX,
          overviewY,
          mapWidth,
          mapHeight,
          topologyId,
          wrapId
        );
        const tile = tilesByCoordinate.get(`${native.x},${native.y}`);
        if (!tile?.known) continue;
        context.globalAlpha = tile.visible ? 1 : 0.55;
        context.fillStyle = terrainColor(tile.terrain);
        context.fillRect(
          overviewX * layout.scaleX,
          overviewY * layout.scaleY,
          layout.scaleX + 0.5,
          layout.scaleY + 0.5
        );

        if (tile.owner) {
          context.globalAlpha = tile.visible ? 0.42 : 0.22;
          context.fillStyle = playerColor(players[tile.owner]?.color, '#94a3b8');
          context.fillRect(
            overviewX * layout.scaleX,
            overviewY * layout.scaleY,
            layout.scaleX + 0.5,
            layout.scaleY + 0.5
          );
        }
      }
    }
    context.globalAlpha = 1;

    for (const city of Object.values(cities)) {
      const tile = tilesByCoordinate.get(`${city.x},${city.y}`);
      if (!isMinimapMarkerVisible(tile, city.playerId, currentPlayerId, false)) continue;
      const { x, y } = markerPosition(city.x, city.y);
      context.fillStyle = playerColor(players[city.playerId]?.color, '#f8fafc');
      context.fillRect(x - 2, y - 2, 4, 4);
      if (city.playerId === currentPlayerId) {
        context.strokeStyle = '#f8fafc';
        context.lineWidth = 1;
        context.strokeRect(x - 3, y - 3, 6, 6);
      }
    }

    for (const unit of Object.values(units)) {
      const tile = tilesByCoordinate.get(`${unit.x},${unit.y}`);
      if (!isMinimapMarkerVisible(tile, unit.playerId, currentPlayerId, true)) continue;
      const { x, y } = markerPosition(unit.x, unit.y);
      context.fillStyle = unit.playerId === currentPlayerId ? '#67e8f9' : '#e2e8f0';
      context.beginPath();
      context.arc(x, y, unit.playerId === currentPlayerId ? 2 : 1.5, 0, 2 * Math.PI);
      context.fill();
    }

    const selectedCity = selectedCityId ? cities[selectedCityId] : undefined;
    if (selectedCity) {
      const { x, y } = markerPosition(selectedCity.x, selectedCity.y);
      context.strokeStyle = '#f8fafc';
      context.lineWidth = 2;
      context.strokeRect(x - 4, y - 4, 8, 8);
    }

    const selectedUnit = selectedUnitId ? units[selectedUnitId] : undefined;
    if (selectedUnit) {
      const { x, y } = markerPosition(selectedUnit.x, selectedUnit.y);
      context.strokeStyle = '#67e8f9';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(x, y, 4.5, 0, 2 * Math.PI);
      context.stroke();
    }
  }, [
    cities,
    currentPlayerId,
    layout,
    map.tiles,
    mapHeight,
    mapWidth,
    players,
    selectedCityId,
    selectedUnitId,
    topologyId,
    wrapId,
    units,
  ]);

  const drawOverlay = useCallback(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    context.clearRect(0, 0, layout.width, layout.height);
    if (!mapWidth || !mapHeight) return;
    const polygons = getMinimapViewportPolygons(
      viewport,
      mapWidth,
      mapHeight,
      wrapId,
      layout,
      tileSize.width,
      tileSize.height,
      topologyId
    );
    context.strokeStyle = VIEWPORT_OUTLINE_COLOR;
    context.lineWidth = VIEWPORT_OUTLINE_WIDTH;
    context.beginPath();
    for (const polygon of polygons) {
      context.moveTo(polygon[0].x, polygon[0].y);
      for (let index = 1; index < polygon.length; index += 1) {
        context.lineTo(polygon[index].x, polygon[index].y);
      }
      context.lineTo(polygon[0].x, polygon[0].y);
    }
    context.stroke();
  }, [layout, mapHeight, mapWidth, tileSize.height, tileSize.width, topologyId, viewport, wrapId]);

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
    if (!canvas || !mapWidth || !mapHeight || !layout.width || !layout.height) return;
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
    const rect = canvas.getBoundingClientRect();
    const localX = ((clientX - rect.left) / (rect.width || layout.width)) * layout.width;
    const localY = ((clientY - rect.top) / (rect.height || layout.height)) * layout.height;
    const point = minimapPointToMapTile(
      localX,
      localY,
      mapWidth,
      mapHeight,
      layout,
      topologyId,
      wrapId
    );
    document.dispatchEvent(
      new CustomEvent('center-map-on-tile', {
        detail: {
          x: Math.max(0, Math.min(mapWidth - 1, point.x)),
          y: Math.max(0, Math.min(mapHeight - 1, point.y)),
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
