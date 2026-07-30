import React, { useCallback, useEffect, useRef } from 'react';
import { Crosshair, Map as MapIcon, Maximize2, Minimize2 } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { HudPanel } from './HudPanel';
import { HudIconButton } from './HudIconButton';

const MINIMAP_WIDTH = 176;
const MINIMAP_HEIGHT = 112;
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

const playerColor = (color: string | undefined, fallback: string): string => color || fallback;

const inverseIsometric = (guiX: number, guiY: number): { x: number; y: number } => ({
  x: guiX / 96 + guiY / 48,
  y: guiY / 48 - guiX / 96,
});

export const Minimap: React.FC = () => {
  const [collapsed, setCollapsed] = React.useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const map = useGameStore(state => state.map);
  const viewport = useGameStore(state => state.viewport);
  const units = useGameStore(state => state.units);
  const cities = useGameStore(state => state.cities);
  const players = useGameStore(state => state.players);
  const currentPlayerId = useGameStore(state => state.currentPlayerId);

  const drawMinimap = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const mapWidth = map.xsize ?? map.width;
    const mapHeight = map.ysize ?? map.height;
    context.clearRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT);
    context.fillStyle = '#0f172a';
    context.fillRect(0, 0, MINIMAP_WIDTH, MINIMAP_HEIGHT);
    if (!mapWidth || !mapHeight) return;

    const cellWidth = MINIMAP_WIDTH / mapWidth;
    const cellHeight = MINIMAP_HEIGHT / mapHeight;
    const tiles = Object.values(map.tiles);

    for (const tile of tiles) {
      if (!tile.known) continue;
      context.globalAlpha = tile.visible ? 1 : 0.55;
      context.fillStyle = terrainColor(tile.terrain);
      context.fillRect(tile.x * cellWidth, tile.y * cellHeight, cellWidth + 0.5, cellHeight + 0.5);

      if (tile.owner) {
        context.globalAlpha = tile.visible ? 0.28 : 0.14;
        context.fillStyle = playerColor(players[tile.owner]?.color, '#94a3b8');
        context.fillRect(tile.x * cellWidth, tile.y * cellHeight, cellWidth + 0.5, cellHeight + 0.5);
      }
    }
    context.globalAlpha = 1;

    for (const city of Object.values(cities)) {
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
      const x = (unit.x + 0.5) * cellWidth;
      const y = (unit.y + 0.5) * cellHeight;
      context.fillStyle = unit.playerId === currentPlayerId ? '#67e8f9' : '#e2e8f0';
      context.beginPath();
      context.arc(x, y, unit.playerId === currentPlayerId ? 2 : 1.5, 0, 2 * Math.PI);
      context.fill();
    }

    const cameraCorners = [
      inverseIsometric(viewport.x, viewport.y),
      inverseIsometric(viewport.x + viewport.width, viewport.y),
      inverseIsometric(viewport.x, viewport.y + viewport.height),
      inverseIsometric(viewport.x + viewport.width, viewport.y + viewport.height),
    ];
    const minX = Math.max(0, Math.min(...cameraCorners.map(point => point.x)));
    const maxX = Math.min(mapWidth, Math.max(...cameraCorners.map(point => point.x)));
    const minY = Math.max(0, Math.min(...cameraCorners.map(point => point.y)));
    const maxY = Math.min(mapHeight, Math.max(...cameraCorners.map(point => point.y)));
    context.strokeStyle = '#f8fafc';
    context.lineWidth = 1.5;
    context.strokeRect(
      minX * cellWidth,
      minY * cellHeight,
      Math.max(cellWidth, (maxX - minX) * cellWidth),
      Math.max(cellHeight, (maxY - minY) * cellHeight)
    );
  }, [cities, currentPlayerId, map, players, units, viewport]);

  useEffect(() => {
    drawMinimap();
  }, [drawMinimap]);

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mapWidth = map.xsize ?? map.width;
    const mapHeight = map.ysize ?? map.height;
    if (!mapWidth || !mapHeight) return;
    const x = Math.floor(((event.clientX - rect.left) / (rect.width || MINIMAP_WIDTH)) * mapWidth);
    const y = Math.floor(((event.clientY - rect.top) / (rect.height || MINIMAP_HEIGHT)) * mapHeight);
    document.dispatchEvent(
      new CustomEvent('center-map-on-tile', {
        detail: { x: Math.max(0, Math.min(mapWidth - 1, x)), y: Math.max(0, Math.min(mapHeight - 1, y)) },
      })
    );
  };

  if (collapsed) {
    return (
      <HudPanel className="hidden w-11 items-center justify-center p-1.5 sm:flex">
        <HudIconButton label="Expand minimap" onClick={() => setCollapsed(false)}>
          <Maximize2 className="h-4 w-4" aria-hidden="true" />
        </HudIconButton>
      </HudPanel>
    );
  }

  return (
    <HudPanel className="hidden w-[11.5rem] overflow-hidden p-1.5 sm:block">
      <div className="flex items-center justify-between px-1 pb-1 text-[9px] font-medium uppercase tracking-[0.14em] text-slate-400">
        <span className="flex items-center gap-1.5">
          <MapIcon className="h-3 w-3 text-cyan-300" aria-hidden="true" />
          Overview
        </span>
        <div className="flex items-center gap-1">
          <Crosshair className="h-3 w-3 text-slate-500" aria-hidden="true" />
          <HudIconButton
            label="Collapse minimap"
            onClick={() => setCollapsed(true)}
            className="h-6 w-6"
          >
            <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
          </HudIconButton>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        width={MINIMAP_WIDTH}
        height={MINIMAP_HEIGHT}
        onClick={handleClick}
        aria-label="Minimap overview"
        className="block h-28 w-44 cursor-crosshair rounded-md border border-white/10 bg-slate-950"
      />
    </HudPanel>
  );
};
