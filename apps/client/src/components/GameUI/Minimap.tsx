/**
 * @module client/components/GameUI/Minimap
 * Defines the Minimap client UI component.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { useGameStore } from '../../store/gameStore';
import { HudPanel } from './HudPanel';
import { isMinimapMarkerVisible } from './minimapVisibility';

const MINIMAP_WIDTH = 220;
const MINIMAP_HEIGHT = 140;
const TILE_COLORS: Record<string, string> = {
  ocean: '#164e63',
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
  return TILE_COLORS[normalized] ?? (normalized === 'unknown' ? '#111827' : '#475569');
};

const isOceanTerrain = (terrain: string | undefined): boolean =>
  terrain?.toLowerCase().includes('ocean') ?? false;

const playerColor = (color: string | undefined, fallback: string): string => color || fallback;

const inverseIsometric = (guiX: number, guiY: number): { x: number; y: number } => ({
  x: guiX / 96 + guiY / 48,
  y: guiY / 48 - guiX / 96,
});

export const Minimap: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);
  const redrawFrameRef = useRef<number | null>(null);
  const map = useGameStore(state => state.map);
  const viewport = useGameStore(state => state.viewport);
  const units = useGameStore(state => state.units);
  const cities = useGameStore(state => state.cities);
  const players = useGameStore(state => state.players);
  const currentPlayerId = useGameStore(state => state.currentPlayerId);
  const selectedCityId = useGameStore(state => state.selectedCityId);
  const selectedUnitId = useGameStore(state => state.selectedUnitId);

  const drawMinimap = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const mapWidth = map.xsize ?? map.width;
    const mapHeight = map.ysize ?? map.height;
    context.clearRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT);
    if (!mapWidth || !mapHeight) return;

    const cellWidth = MINIMAP_WIDTH / mapWidth;
    const cellHeight = MINIMAP_HEIGHT / mapHeight;
    const tiles = Object.values(map.tiles);
    const tilesByCoordinate = new Map(tiles.map(tile => [`${tile.x},${tile.y}`, tile]));

    for (const tile of tiles) {
      if (!tile.known) continue;
      context.globalAlpha = tile.visible ? 1 : 0.55;
      if (!isOceanTerrain(tile.terrain)) {
        context.fillStyle = terrainColor(tile.terrain);
        context.fillRect(
          tile.x * cellWidth,
          tile.y * cellHeight,
          cellWidth + 0.5,
          cellHeight + 0.5
        );
      }

      if (tile.owner) {
        context.globalAlpha = tile.visible ? 0.42 : 0.22;
        context.fillStyle = playerColor(players[tile.owner]?.color, '#94a3b8');
        context.fillRect(
          tile.x * cellWidth,
          tile.y * cellHeight,
          cellWidth + 0.5,
          cellHeight + 0.5
        );
      }
    }
    context.globalAlpha = 1;

    for (const city of Object.values(cities)) {
      const tile = tilesByCoordinate.get(`${city.x},${city.y}`);
      if (!isMinimapMarkerVisible(tile, city.playerId, currentPlayerId, false)) continue;
      const x = (city.x + 0.5) * cellWidth;
      const y = (city.y + 0.5) * cellHeight;
      context.fillStyle = playerColor(players[city.playerId]?.color, '#f8fafc');
      context.fillRect(Math.max(0, x - 2), Math.max(0, y - 2), 4, 4);
      if (city.playerId === currentPlayerId) {
        context.strokeStyle = '#f8fafc';
        context.lineWidth = 1;
        context.strokeRect(Math.max(0, x - 3), Math.max(0, y - 3), 6, 6);
      }
    }

    for (const unit of Object.values(units)) {
      const tile = tilesByCoordinate.get(`${unit.x},${unit.y}`);
      if (!isMinimapMarkerVisible(tile, unit.playerId, currentPlayerId, true)) continue;
      const x = (unit.x + 0.5) * cellWidth;
      const y = (unit.y + 0.5) * cellHeight;
      context.fillStyle = unit.playerId === currentPlayerId ? '#67e8f9' : '#e2e8f0';
      context.beginPath();
      context.arc(x, y, unit.playerId === currentPlayerId ? 2 : 1.5, 0, 2 * Math.PI);
      context.fill();
    }

    const selectedCity = selectedCityId ? cities[selectedCityId] : undefined;
    if (selectedCity) {
      const x = (selectedCity.x + 0.5) * cellWidth;
      const y = (selectedCity.y + 0.5) * cellHeight;
      context.strokeStyle = '#f8fafc';
      context.lineWidth = 2;
      context.strokeRect(Math.max(0, x - 4), Math.max(0, y - 4), 8, 8);
    }

    const selectedUnit = selectedUnitId ? units[selectedUnitId] : undefined;
    if (selectedUnit) {
      const x = (selectedUnit.x + 0.5) * cellWidth;
      const y = (selectedUnit.y + 0.5) * cellHeight;
      context.strokeStyle = '#67e8f9';
      context.lineWidth = 2;
      context.beginPath();
      context.arc(x, y, 4.5, 0, 2 * Math.PI);
      context.stroke();
    }

    const cameraCorners = [
      inverseIsometric(viewport.x, viewport.y),
      inverseIsometric(viewport.x + viewport.width, viewport.y),
      inverseIsometric(viewport.x + viewport.width, viewport.y + viewport.height),
      inverseIsometric(viewport.x, viewport.y + viewport.height),
    ];
    context.strokeStyle = '#f8fafc';
    context.lineWidth = 1.5;
    context.beginPath();
    cameraCorners.forEach((point, index) => {
      const x = point.x * cellWidth;
      const y = point.y * cellHeight;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
    context.stroke();
  }, [cities, currentPlayerId, map, players, selectedCityId, selectedUnitId, units, viewport]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      redrawFrameRef.current = null;
      drawMinimap();
    });
    redrawFrameRef.current = frameId;

    return () => {
      window.cancelAnimationFrame(frameId);
      if (redrawFrameRef.current === frameId) redrawFrameRef.current = null;
    };
  }, [drawMinimap]);

  const centerFromPointer = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
    const rect = canvas.getBoundingClientRect();
    const mapWidth = map.xsize ?? map.width;
    const mapHeight = map.ysize ?? map.height;
    if (!mapWidth || !mapHeight) return;
    const x = Math.floor(((clientX - rect.left) / (rect.width || MINIMAP_WIDTH)) * mapWidth);
    const y = Math.floor(((clientY - rect.top) / (rect.height || MINIMAP_HEIGHT)) * mapHeight);
    document.dispatchEvent(
      new CustomEvent('center-map-on-tile', {
        detail: {
          x: Math.max(0, Math.min(mapWidth - 1, x)),
          y: Math.max(0, Math.min(mapHeight - 1, y)),
        },
      })
    );
  };

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    centerFromPointer(event.clientX, event.clientY);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    centerFromPointer(event.clientX, event.clientY);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (draggingRef.current) centerFromPointer(event.clientX, event.clientY);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
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

  return (
    <HudPanel className="hidden w-[234px] overflow-hidden p-1.5 sm:block">
      <canvas
        ref={canvasRef}
        width={MINIMAP_WIDTH}
        height={MINIMAP_HEIGHT}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        aria-label={`Minimap overview${selectionLabel}`}
        className="block h-[140px] w-[220px] cursor-crosshair touch-none rounded-md"
      />
    </HudPanel>
  );
};
