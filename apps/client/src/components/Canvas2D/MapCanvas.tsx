import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { MapRenderer } from './MapRenderer';

interface MapCanvasProps {
  width: number;
  height: number;
}

export const MapCanvas: React.FC<MapCanvasProps> = ({ width, height }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<MapRenderer | null>(null);

  const { viewport, map, units, cities, setViewport } = useGameStore();
  const gameState = useGameStore();

  // Initialize renderer and load tileset
  useEffect(() => {
    const initRenderer = async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      rendererRef.current = new MapRenderer(ctx);

      try {
        // Initialize with server URL from config
        const { SERVER_URL } = await import('../../config');
        await rendererRef.current.initialize(SERVER_URL);
        const gameState = useGameStore.getState();

        if (rendererRef.current) {
          rendererRef.current.render({
            viewport,
            map: gameState.map,
            units: gameState.units,
            cities: gameState.cities,
          });
        }
      } catch (error) {
        console.error('Failed to initialize MapRenderer:', error);
      }
    };

    initRenderer();

    return () => {
      rendererRef.current?.cleanup();
    };
  }, []);

  // Update canvas size
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = width;
    canvas.height = height;

    setViewport({ width, height });
  }, [width, height, setViewport]);

  // Center the viewport on user's starting position when data becomes available
  useEffect(() => {
    const globalMap = (window as { map?: { xsize: number; ysize: number } })
      .map;
    if (
      rendererRef.current &&
      globalMap &&
      globalMap.xsize &&
      globalMap.ysize &&
      viewport.x === 0 &&
      viewport.y === 0
    ) {
      // Try to find user's starting position - prioritize mapData starting positions
      let startTile = null;

      // FIRST: Try to find player's assigned starting position from map generation
      const currentPlayerId = gameState.currentPlayerId;
      const playerStartPos = gameState.mapData?.startingPositions?.find(
        pos => pos.playerId === currentPlayerId
      );

      if (playerStartPos) {
        startTile = { x: playerStartPos.x, y: playerStartPos.y };
        console.log('Found player starting position at:', startTile);
      } else {
        // FALLBACK 1: Try to find user's first unit
        const userUnits = Object.values(units);
        if (userUnits.length > 0) {
          const firstUnit = userUnits[0] as { x: number; y: number };
          startTile = { x: firstUnit.x, y: firstUnit.y };
          console.log('Found user unit at:', startTile);
        } else {
          // FALLBACK 2: Try to find user's first city
          const userCities = Object.values(cities);
          if (userCities.length > 0) {
            const firstCity = userCities[0] as { x: number; y: number };
            startTile = { x: firstCity.x, y: firstCity.y };
            console.log('Found user city at:', startTile);
          } else {
            // FALLBACK 3: Try to find any visible tile from global tiles
            const globalTiles = (
              window as {
                tiles?: Array<{
                  x: number;
                  y: number;
                  known: number;
                  seen: number;
                }>;
              }
            ).tiles;
            if (globalTiles) {
              for (const tile of globalTiles) {
                if (tile && (tile.known > 0 || tile.seen > 0)) {
                  startTile = { x: tile.x, y: tile.y };
                  break;
                }
              }
            }
          }
        }
      }

      if (startTile && rendererRef.current) {
        // Center on the starting tile (like freeciv-web's center_tile_mapcanvas)
        const tileGui = rendererRef.current.mapToGuiVector(
          startTile.x,
          startTile.y
        );
        const centeredX = tileGui.guiDx - viewport.width / 2;
        const centeredY = tileGui.guiDy - viewport.height / 2;

        setViewport({
          ...viewport,
          x: centeredX,
          y: centeredY,
        });
      }
    }
  }, [
    map,
    units,
    cities,
    gameState.mapData,
    gameState.currentPlayerId,
    viewport.x,
    viewport.y,
    viewport.width,
    viewport.height,
    setViewport,
  ]);

  // Render game state
  useEffect(() => {
    if (!rendererRef.current || !canvasRef.current) return;

    rendererRef.current.render({
      viewport,
      map,
      units,
      cities,
    });
  }, [viewport, map, units, cities]);

  // Handle mouse events - copied from freeciv-web 2D canvas behavior
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const dragStartViewport = useRef(viewport);
  const currentRenderViewport = useRef(viewport);

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (event.button !== 0) return; // Only handle left mouse button

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const canvasX = event.clientX - rect.left;
      const canvasY = event.clientY - rect.top;

      // Start dragging - copy freeciv-web logic
      setIsDragging(true);
      dragStart.current = { x: canvasX, y: canvasY };
      dragStartViewport.current = viewport;
      currentRenderViewport.current = viewport;

      // Change cursor to indicate dragging
      canvas.style.cursor = 'move';
    },
    [viewport]
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDragging || !rendererRef.current) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const canvasX = event.clientX - rect.left;
      const canvasY = event.clientY - rect.top;

      // Calculate total movement from drag start (like freeciv-web)
      const totalDiffX = (dragStart.current.x - canvasX) * 2;
      const totalDiffY = (dragStart.current.y - canvasY) * 2;

      // Calculate new viewport position from original position
      const newViewport = {
        ...dragStartViewport.current,
        x: dragStartViewport.current.x + totalDiffX,
        y: dragStartViewport.current.y + totalDiffY,
      };

      // Store current render viewport
      currentRenderViewport.current = newViewport;

      // Directly render without any state updates during drag - use requestAnimationFrame for smoothness
      requestAnimationFrame(() => {
        if (rendererRef.current) {
          rendererRef.current.render({
            viewport: newViewport,
            map: useGameStore.getState().map,
            units: useGameStore.getState().units,
            cities: useGameStore.getState().cities,
          });
        }
      });
    },
    [isDragging]
  );

  const handleMouseUp = useCallback(() => {
    if (!isDragging || !rendererRef.current) return;

    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.cursor = 'crosshair';
    }

    // Apply boundary constraints to the final viewport position
    const constrainedPosition = rendererRef.current.setMapviewOrigin(
      currentRenderViewport.current.x,
      currentRenderViewport.current.y,
      currentRenderViewport.current.width,
      currentRenderViewport.current.height
    );

    const finalViewport = {
      ...currentRenderViewport.current,
      x: constrainedPosition.x,
      y: constrainedPosition.y,
    };

    // Update state with the constrained final position
    setViewport(finalViewport);
    setIsDragging(false);
  }, [isDragging, setViewport]);

  // Global mouse up handler to catch mouse up events outside the canvas
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDragging && rendererRef.current) {
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.style.cursor = 'crosshair';
        }

        // Apply boundary constraints to the final viewport position
        const constrainedPosition = rendererRef.current.setMapviewOrigin(
          currentRenderViewport.current.x,
          currentRenderViewport.current.y,
          currentRenderViewport.current.width,
          currentRenderViewport.current.height
        );

        const finalViewport = {
          ...currentRenderViewport.current,
          x: constrainedPosition.x,
          y: constrainedPosition.y,
        };

        setViewport(finalViewport);
        setIsDragging(false);
      }
    };

    if (isDragging) {
      document.addEventListener('mouseup', handleGlobalMouseUp);
      return () => document.removeEventListener('mouseup', handleGlobalMouseUp);
    }
  }, [isDragging, handleMouseUp]);

  // Removed zoom functionality to match freeciv-web 2D canvas behavior
  // Freeciv-web's 2D renderer does not support zoom - only the WebGL renderer does

  return (
    <div className="relative overflow-hidden bg-blue-900 w-full h-full">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className="cursor-crosshair w-full h-full"
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  );
};
