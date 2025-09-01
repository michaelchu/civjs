import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { MapRenderer } from './MapRenderer';
import { TileHoverOverlay } from './TileHoverOverlay';
import { UnitContextMenu } from '../GameUI/UnitContextMenu';
import { UnitSelectionOverlay } from './UnitSelectionOverlay';
import type { Unit } from '../../types';
import { ActionType } from '../../types/shared/actions';
import { gameClient } from '../../services/GameClient';

interface MapCanvasProps {
  width: number;
  height: number;
}

export const MapCanvas: React.FC<MapCanvasProps> = ({ width, height }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<MapRenderer | null>(null);

  // Track initial centering to prevent multiple centering events (freeciv-web compliance)
  const [hasInitiallyCentered, setHasInitiallyCentered] = useState(false);

  // Unit selection and context menu state
  const [selectedUnit, setSelectedUnit] = useState<Unit | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    unit: Unit;
    position: { x: number; y: number };
  } | null>(null);

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
        // Initialize renderer (tileset files are now served from client domain)
        await rendererRef.current.initialize();
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
  // Reference-compliant: centers exactly once on startup like freeciv-web
  useEffect(() => {
    // Skip if already centered (prevents multiple centering events)
    if (hasInitiallyCentered) {
      return;
    }

    const globalMap = (window as { map?: { xsize: number; ysize: number } }).map;
    if (!rendererRef.current || !globalMap || !globalMap.xsize || !globalMap.ysize) {
      return;
    }

    // Try to find user's starting position - prioritize mapData starting positions
    let startTile = null;

    // FIRST: Try to find player's assigned starting position from map generation
    const currentPlayerId = gameState.currentPlayerId;
    const playerStartPos = gameState.mapData?.startingPositions?.find(
      (pos: { x: number; y: number; playerId: string }) => pos.playerId === currentPlayerId
    );

    if (playerStartPos) {
      startTile = { x: playerStartPos.x, y: playerStartPos.y };
      console.log('Found player starting position at:', startTile);
    } else {
      // FALLBACK 1: Try to find user's first unit (matches freeciv-web behavior)
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
      const tileGui = rendererRef.current.mapToGuiVector(startTile.x, startTile.y);
      const centeredX = tileGui.guiDx - viewport.width / 2;
      const centeredY = tileGui.guiDy - viewport.height / 2;

      setViewport({
        ...viewport,
        x: centeredX,
        y: centeredY,
      });

      // Mark as initially centered to prevent future centering
      setHasInitiallyCentered(true);
      console.log('Initial camera centering completed');
    }
  }, [
    // Minimal dependencies to reduce race conditions
    gameState.mapData,
    gameState.currentPlayerId,
    hasInitiallyCentered,
    // Only include units/cities length to avoid object reference changes
    Object.keys(units).length,
    Object.keys(cities).length,
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

  // Handle mouse and touch events - copied from freeciv-web 2D canvas behavior
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredTile, setHoveredTile] = useState<string | null>(null);
  const dragStart = useRef({ x: 0, y: 0 });
  const dragStartViewport = useRef(viewport);
  const currentRenderViewport = useRef(viewport);
  const dragStartTime = useRef<number>(0);
  const DRAG_THRESHOLD = 5; // pixels

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (event.button !== 0) return; // Only handle left mouse button

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const canvasX = event.clientX - rect.left;
      const canvasY = event.clientY - rect.top;

      // Close context menu if open
      setContextMenu(null);

      // Record drag start for potential drag operation
      dragStart.current = { x: canvasX, y: canvasY };
      dragStartViewport.current = viewport;
      currentRenderViewport.current = viewport;
      dragStartTime.current = Date.now();

      // Don't immediately set dragging - wait for actual movement
    },
    [viewport]
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || !rendererRef.current) return;

      const rect = canvas.getBoundingClientRect();
      const canvasX = event.clientX - rect.left;
      const canvasY = event.clientY - rect.top;

      // Check if we should start dragging
      if (!isDragging && dragStartTime.current > 0) {
        const dragDistance = Math.sqrt(
          Math.pow(canvasX - dragStart.current.x, 2) + Math.pow(canvasY - dragStart.current.y, 2)
        );

        if (dragDistance > DRAG_THRESHOLD) {
          setIsDragging(true);
          canvas.style.cursor = 'move';
        }
      }

      // Handle tile hover detection when not dragging
      if (!isDragging) {
        const mapPos = rendererRef.current.canvasToMap(canvasX, canvasY, viewport);
        const globalTiles = (window as { tiles?: Array<{ x: number; y: number; terrain: string }> })
          .tiles;

        if (globalTiles) {
          // Find the tile at the mouse position
          const hoveredTileData = globalTiles.find(
            tile =>
              tile &&
              Math.floor(tile.x) === Math.floor(mapPos.mapX) &&
              Math.floor(tile.y) === Math.floor(mapPos.mapY)
          );

          if (hoveredTileData && hoveredTileData.terrain) {
            // Format terrain name to be human readable
            const terrainName = hoveredTileData.terrain
              .replace(/_/g, ' ')
              .replace(/\b\w/g, (l: string) => l.toUpperCase());
            setHoveredTile(
              `${terrainName} (${Math.floor(mapPos.mapX)}, ${Math.floor(mapPos.mapY)})`
            );
          } else {
            setHoveredTile(null);
          }
        }
        return;
      }

      // Original dragging logic
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
    [isDragging, viewport]
  );

  const handleMouseUp = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || !rendererRef.current) return;

      const rect = canvas.getBoundingClientRect();
      const canvasX = event.clientX - rect.left;
      const canvasY = event.clientY - rect.top;

      // If we were dragging, handle the drag end
      if (isDragging) {
        canvas.style.cursor = 'crosshair';

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
      } else if (dragStartTime.current > 0) {
        // Handle click (not drag) - check for unit selection
        const mapPos = rendererRef.current.canvasToMap(canvasX, canvasY, viewport);
        const tileX = Math.floor(mapPos.mapX);
        const tileY = Math.floor(mapPos.mapY);

        // Find unit at clicked position
        const unitAtPosition = Object.values(units).find(
          (unit: Unit) => unit.x === tileX && unit.y === tileY
        );

        if (unitAtPosition) {
          setSelectedUnit(unitAtPosition as Unit);
        } else {
          setSelectedUnit(null);
        }
      }

      // Reset drag tracking
      dragStartTime.current = 0;
    },
    [isDragging, setViewport, units, viewport]
  );

  // Touch event handlers for mobile panning
  const handleTouchStart = useCallback(
    (event: React.TouchEvent<HTMLCanvasElement>) => {
      if (event.touches.length !== 1) return; // Only handle single touch

      const canvas = canvasRef.current;
      if (!canvas) return;

      const touch = event.touches[0];
      const rect = canvas.getBoundingClientRect();
      const canvasX = touch.clientX - rect.left;
      const canvasY = touch.clientY - rect.top;

      // Start dragging - same logic as mouse
      setIsDragging(true);
      dragStart.current = { x: canvasX, y: canvasY };
      dragStartViewport.current = viewport;
      currentRenderViewport.current = viewport;

      // Prevent default to avoid page scrolling
      event.preventDefault();
    },
    [viewport]
  );

  const handleTouchMove = useCallback(
    (event: React.TouchEvent<HTMLCanvasElement>) => {
      if (!isDragging || !rendererRef.current || event.touches.length !== 1) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const touch = event.touches[0];
      const rect = canvas.getBoundingClientRect();
      const canvasX = touch.clientX - rect.left;
      const canvasY = touch.clientY - rect.top;

      // Calculate total movement from drag start (same as mouse logic)
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

      // Directly render without any state updates during drag
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

      // Prevent default to avoid page scrolling
      event.preventDefault();
    },
    [isDragging]
  );

  const handleTouchEnd = useCallback(
    (event: React.TouchEvent<HTMLCanvasElement>) => {
      if (!isDragging || !rendererRef.current) return;

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

      // Prevent default to avoid unwanted click events
      event.preventDefault();
    },
    [isDragging, setViewport]
  );

  // Handle right-click context menu
  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      event.preventDefault(); // Prevent browser context menu

      const canvas = canvasRef.current;
      if (!canvas || !rendererRef.current) return;

      const rect = canvas.getBoundingClientRect();
      const canvasX = event.clientX - rect.left;
      const canvasY = event.clientY - rect.top;

      // Convert canvas coordinates to map coordinates
      const mapPos = rendererRef.current.canvasToMap(canvasX, canvasY, viewport);
      const tileX = Math.floor(mapPos.mapX);
      const tileY = Math.floor(mapPos.mapY);

      // Find unit at right-clicked position
      const unitAtPosition = Object.values(units).find(
        (unit: Unit) => unit.x === tileX && unit.y === tileY
      );

      if (unitAtPosition) {
        // Show context menu for the unit
        setContextMenu({
          unit: unitAtPosition as Unit,
          position: { x: event.clientX, y: event.clientY },
        });
        setSelectedUnit(unitAtPosition as Unit);
      }
    },
    [units, viewport]
  );

  // Handle unit action selection
  const handleActionSelect = useCallback(
    async (action: ActionType, targetX?: number, targetY?: number) => {
      if (!selectedUnit) return;

      console.log(`Selected action ${action} for unit ${selectedUnit.id}`, {
        unitId: selectedUnit.id,
        action,
        targetX,
        targetY,
      });

      // Send action to server via GameClient
      try {
        const success = await gameClient.requestUnitAction(
          selectedUnit.id,
          action,
          targetX,
          targetY
        );

        if (success) {
          console.log(`Successfully requested ${action} for unit ${selectedUnit.id}`);
          // TODO: Handle different action types for immediate UI feedback
          switch (action) {
            case ActionType.FORTIFY:
              console.log('Unit fortified');
              break;
            case ActionType.SENTRY:
              console.log('Unit on sentry duty');
              break;
            case ActionType.GOTO:
              console.log(`Unit moving to (${targetX}, ${targetY})`);
              break;
            default:
              console.log(`Action ${action} executed`);
          }
        } else {
          console.error(`Failed to execute ${action} for unit ${selectedUnit.id}`);
        }
      } catch (error) {
        console.error(`Error executing unit action:`, error);
      }
    },
    [selectedUnit]
  );

  // Close context menu when clicking elsewhere
  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

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

      // Reset drag tracking
      dragStartTime.current = 0;
    };

    if (isDragging || dragStartTime.current > 0) {
      document.addEventListener('mouseup', handleGlobalMouseUp);
      return () => document.removeEventListener('mouseup', handleGlobalMouseUp);
    }
  }, [isDragging, setViewport]);

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
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        className="cursor-crosshair w-full h-full"
        style={{
          imageRendering: 'pixelated',
          touchAction: 'none', // Prevent default touch behaviors like scrolling/zooming
        }}
      />
      <TileHoverOverlay tileInfo={hoveredTile} />
      <UnitSelectionOverlay
        selectedUnit={selectedUnit}
        mapRenderer={rendererRef.current}
        viewport={viewport}
      />
      {contextMenu && (
        <UnitContextMenu
          unit={contextMenu.unit}
          position={contextMenu.position}
          onClose={handleCloseContextMenu}
          onActionSelect={handleActionSelect}
        />
      )}
    </div>
  );
};
