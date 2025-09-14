// Reference: /root/repo/reference/freeciv-web/javascript/overview.js
import React, { useEffect, useRef, useCallback } from 'react';
import { useGameStore } from '../../store/gameStore';
import { MinimapRenderer } from '../../utils/minimapRenderer';
import type { MinimapColorMode, MinimapRenderOptions } from '../../utils/minimapRenderer';

interface MinimapCanvasProps {
  width: number;
  height: number;
  colorMode: MinimapColorMode;
  onTileClick?: (x: number, y: number) => void;
  className?: string;
}

export const MinimapCanvas: React.FC<MinimapCanvasProps> = ({
  width,
  height,
  colorMode,
  onTileClick,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewrectCanvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<MinimapRenderer>(new MinimapRenderer());

  const gameStore = useGameStore();
  const {
    map,
    players,
    terrainTypes,
    nations,
    currentPlayerId,
    isObserver,
    diplomaticStates,
    viewport,
    turn,
    phase,
    units,
    cities,
    technologies,
    governments,
  } = gameStore;

  // const currentPlayer = currentPlayerId ? players[currentPlayerId] : null;

  const gameState = {
    turn,
    phase,
    map,
    players,
    currentPlayerId,
    units,
    cities,
    technologies,
    governments,
    terrainTypes,
    nations,
    isObserver,
    diplomaticStates,
  };

  /**
   * Render the main minimap
   * Reference: freeciv-web/javascript/overview.js:143-158
   */
  const redrawMinimap = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !map) return;

    const renderer = rendererRef.current;

    // Calculate tile size based on canvas dimensions
    let tileSize = 1;
    const minWidth = 200;
    const mapWidth = map.xsize || map.width;
    while (minWidth > tileSize * mapWidth && tileSize < 4) {
      tileSize++;
    }

    const options: MinimapRenderOptions = {
      colorMode,
      tileSize,
      showUnits: true,
      showCities: true,
    };

    // Generate hash to check if redraw is needed
    const hash = renderer.generateHash(gameState, viewport.x, viewport.y);

    if (renderer.hasChanged(hash)) {
      // Generate palette and grid
      const palette = renderer.generatePalette(gameState, colorMode);
      const grid = renderer.generateOverviewGrid(gameState, options);

      // Calculate actual render dimensions
      const mapHeight = map.ysize || map.height;
      const renderWidth = Math.min(width, mapWidth * tileSize);
      const renderHeight = Math.min(height, mapHeight * tileSize);

      // Render to canvas
      renderer.renderToCanvas(canvas, grid, palette, renderWidth, renderHeight);

      // Render viewport rectangle
      renderViewrect();
    }
  }, [gameState, colorMode, width, height, viewport, map]);

  /**
   * Render the viewport rectangle showing current view
   * Reference: freeciv-web/javascript/overview.js:233-321
   */
  const renderViewrect = useCallback(() => {
    const viewrectCanvas = viewrectCanvasRef.current;
    if (!viewrectCanvas || !map || !viewport) return;

    const ctx = viewrectCanvas.getContext('2d');
    if (!ctx) return;

    // Set canvas dimensions to match minimap
    viewrectCanvas.width = width;
    viewrectCanvas.height = height;

    ctx.clearRect(0, 0, width, height);

    // Calculate viewport rectangle in minimap coordinates
    const mapWidth = map.xsize || map.width;
    const mapHeight = map.ysize || map.height;
    const scaleX = width / mapWidth;
    const scaleY = height / mapHeight;

    // Convert viewport bounds to minimap coordinates
    const viewX = viewport.x * scaleX;
    const viewY = viewport.y * scaleY;
    const viewWidth = (viewport.width || 20) * scaleX; // Default viewport size
    const viewHeight = (viewport.height || 15) * scaleY;

    // Draw viewport rectangle
    ctx.strokeStyle = 'rgb(200, 200, 255)'; // Light blue
    ctx.lineWidth = 2;
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.rect(viewX, viewY, viewWidth, viewHeight);
    ctx.stroke();

    // Handle world wrapping if needed (simplified version)
    // Note: topology handling would need to be implemented based on actual game state
    // if (map.topology && map.topology.includes('WRAPX')) {
    //   ctx.beginPath();
    //   ctx.rect(viewX + width, viewY, viewWidth, viewHeight);
    //   ctx.rect(viewX - width, viewY, viewWidth, viewHeight);
    //   ctx.stroke();
    // }
  }, [map, viewport, width, height]);

  /**
   * Handle clicks on the minimap to center the main map
   * Reference: freeciv-web/javascript/overview.js:459-475
   */
  const handleCanvasClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!map || !onTileClick) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      // Convert click coordinates to map coordinates
      const mapWidth = map.xsize || map.width;
      const mapHeight = map.ysize || map.height;
      const mapX = Math.floor((x * mapWidth) / width);
      const mapY = Math.floor((y * mapHeight) / height);

      onTileClick(mapX, mapY);
    },
    [map, width, height, onTileClick]
  );

  // Redraw when dependencies change
  useEffect(() => {
    redrawMinimap();
  }, [redrawMinimap]);

  // Redraw viewport rectangle when viewport changes
  useEffect(() => {
    renderViewrect();
  }, [renderViewrect]);

  return (
    <div className={`relative ${className}`} style={{ width, height }}>
      {/* Main minimap canvas */}
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onClick={handleCanvasClick}
        onDragStart={e => e.preventDefault()} // Prevent drag artifacts
        className="absolute top-0 left-0 cursor-pointer"
        style={{
          imageRendering: 'pixelated', // Keep sharp pixels for the minimap
          width,
          height,
        }}
      />

      {/* Viewport rectangle overlay */}
      <canvas
        ref={viewrectCanvasRef}
        width={width}
        height={height}
        className="absolute top-0 left-0 pointer-events-none"
        style={{ width, height }}
      />
    </div>
  );
};
