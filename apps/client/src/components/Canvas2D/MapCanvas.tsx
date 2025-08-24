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
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

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
      setDragStart({ x: canvasX, y: canvasY });

      // Change cursor to indicate dragging
      canvas.style.cursor = 'move';
    },
    []
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isDragging) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const canvasX = event.clientX - rect.left;
      const canvasY = event.clientY - rect.top;

      // Copy freeciv-web panning logic exactly
      const diff_x = (dragStart.x - canvasX) * 2;
      const diff_y = (dragStart.y - canvasY) * 2;

      // Update viewport position (equivalent to mapview['gui_x0'] and mapview['gui_y0'])
      setViewport({
        x: viewport.x + diff_x,
        y: viewport.y + diff_y,
      });

      // Update drag start position for next move
      setDragStart({ x: canvasX, y: canvasY });
    },
    [isDragging, dragStart, viewport, setViewport]
  );

  const handleMouseUp = useCallback(() => {
    if (!isDragging) return;

    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.cursor = 'crosshair';
    }

    setIsDragging(false);
  }, [isDragging]);

  // Global mouse up handler to catch mouse up events outside the canvas
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDragging) {
        handleMouseUp();
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
    <div className="relative overflow-hidden bg-blue-900">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className="cursor-crosshair"
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  );
};
