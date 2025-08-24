import React, { useRef, useEffect, useCallback } from 'react';
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

  // Handle mouse events
  const handleMouseDown = useCallback(() => {
    if (!rendererRef.current) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    // const rect = canvas.getBoundingClientRect();
    // const canvasX = event.clientX - rect.left;
    // const canvasY = event.clientY - rect.top;

    // Convert canvas coordinates to map coordinates
    // const mapCoords = rendererRef.current.canvasToMap(
    //   canvasX,
    //   canvasY,
    //   viewport
    // );

    // Handle tile selection, unit selection, etc.
    // This will be expanded later
  }, [viewport]);

  const handleMouseMove = useCallback(() => {
    // Handle mouse move for hover effects, drag operations, etc.
    // This will be implemented later
  }, []);

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLCanvasElement>) => {
      event.preventDefault();

      // Zoom in/out
      const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.5, Math.min(3.0, viewport.zoom * zoomFactor));

      setViewport({ zoom: newZoom });
    },
    [viewport.zoom, setViewport]
  );

  return (
    <div className="relative overflow-hidden bg-blue-900">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onWheel={handleWheel}
        className="cursor-crosshair"
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  );
};
