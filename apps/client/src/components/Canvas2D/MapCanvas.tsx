import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { MapRenderer } from './MapRenderer';
import { TileHoverOverlay } from './TileHoverOverlay';
import { UnitContextMenu } from '../GameUI/UnitContextMenu';
import { CityNameDialog } from '../GameUI/CityNameDialog';
import { CityInfoOverlay } from '../GameUI/CityInfoOverlay';
import type { Unit, City, ProductionOption } from '../../types';
import { ActionType } from '../../types/shared/actions';
import { gameClient } from '../../services/GameClient';
import { pathfindingService, type GotoPath } from '../../services/PathfindingService';
import {
  determineMapClickAction,
  getUnitsAtTile,
  shouldIgnoreClick,
  type ClickOptions,
} from '../../utils/mapInteraction';

interface MapCanvasProps {
  width: number;
  height: number;
}

export const MapCanvas: React.FC<MapCanvasProps> = ({ width, height }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<MapRenderer | null>(null);

  // Track initial centering to prevent multiple centering events (freeciv-web compliance)
  const [hasInitiallyCentered, setHasInitiallyCentered] = useState(false);

  // Track global tiles changes for render triggering - more stable than store map
  const [globalTilesVersion, setGlobalTilesVersion] = useState(0);

  // Unit selection and context menu state
  const [selectedUnit, setSelectedUnit] = useState<Unit | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    unit: Unit;
    position: { x: number; y: number };
  } | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // City naming dialog state
  const [cityNameDialog, setCityNameDialog] = useState<{
    isOpen: boolean;
    unit: Unit | null;
  }>({
    isOpen: false,
    unit: null,
  });

  // City info overlay state
  const [cityInfoOverlay, setCityInfoOverlay] = useState<{
    isOpen: boolean;
    city: City | null;
  }>({
    isOpen: false,
    city: null,
  });

  // Production data state
  const [productionData, setProductionData] = useState<{
    availableProductions: ProductionOption[];
    isLoading: boolean;
    cityId: string | null;
  }>({
    availableProductions: [],
    isLoading: false,
    cityId: null,
  });

  // Goto mode state (similar to freeciv-web's goto_active)
  // @reference freeciv-web/freeciv-web/src/main/webapp/javascript/control.js - goto_active variable
  const [gotoMode, setGotoMode] = useState<{
    active: boolean;
    unit: Unit | null;
    targetTile: { x: number; y: number } | null;
    currentPath: GotoPath | null;
  }>({
    active: false,
    unit: null,
    targetTile: null,
    currentPath: null,
  });
  const [targetActionMode, setTargetActionMode] = useState<{
    unit: Unit;
    action: ActionType;
  } | null>(null);

  const {
    viewport,
    map,
    units,
    cities,
    players,
    currentPlayerId,
    focusedUnits,
    setViewport,
    selectUnit,
    addToFocus,
  } = useGameStore();
  const gameState = useGameStore();

  // Track click state for multi-select
  const lastClickTime = useRef<number>(0);
  const lastClickTile = useRef<{ x: number; y: number } | null>(null);

  // Handle keyboard-triggered actions
  useEffect(() => {
    const handleActivateGoto = (event: CustomEvent) => {
      const { unit } = event.detail;
      if (unit && focusedUnits.includes(unit.id)) {
        setGotoMode({
          active: true,
          unit,
          targetTile: null,
          currentPath: null,
        });
        console.log('Goto mode activated via keyboard for unit:', unit.id);
      }
    };

    const handleShowActionDialog = (event: CustomEvent) => {
      const { unit } = event.detail;
      if (!unit || !canvasRef.current) return;
      const bounds = canvasRef.current.getBoundingClientRect();
      setSelectedUnit(unit);
      selectUnit(unit.id);
      setContextMenu({
        unit,
        position: {
          x: bounds.left + bounds.width / 2,
          y: bounds.top + Math.min(bounds.height / 2, 300),
        },
      });
    };

    const handleShowCityNameDialog = (event: CustomEvent) => {
      const { unit } = event.detail;
      console.log('City name dialog requested for unit:', unit.id);
      setCityNameDialog({
        isOpen: true,
        unit: unit,
      });
    };

    document.addEventListener('activate-goto-mode', handleActivateGoto as EventListener);
    document.addEventListener('show-action-dialog', handleShowActionDialog as EventListener);
    document.addEventListener('show-city-name-dialog', handleShowCityNameDialog as EventListener);

    return () => {
      document.removeEventListener('activate-goto-mode', handleActivateGoto as EventListener);
      document.removeEventListener('show-action-dialog', handleShowActionDialog as EventListener);
      document.removeEventListener(
        'show-city-name-dialog',
        handleShowCityNameDialog as EventListener
      );
    };
  }, [focusedUnits, selectUnit, setGotoMode]);

  // Handle mouse and touch events - copied from freeciv-web 2D canvas behavior
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredTile, setHoveredTile] = useState<string | null>(null);

  // Initialize renderer and load tileset - only once, not on viewport changes!
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
            viewport: gameState.viewport,
            map: gameState.map,
            units: gameState.units,
            cities: gameState.cities,
            players: gameState.players,
            selectedUnitId: gameState.selectedUnitId,
            focusedUnits: gameState.focusedUnits,
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
  }, []); // Empty dependency array - initialize only once!

  // Update canvas size
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = width;
    canvas.height = height;

    setViewport({ width, height });
  }, [width, height, setViewport]);

  // Extract complex expressions to satisfy ESLint rule
  const unitsCount = Object.keys(units).length;
  const citiesCount = Object.keys(cities).length;

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
      pos => pos.playerId === currentPlayerId
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
    // Use extracted variables instead of complex expressions
    unitsCount,
    citiesCount,
    setViewport,
    cities,
    units,
    viewport,
  ]);

  // Render game state - use global tiles for stability (same source as MapRenderer)
  useEffect(() => {
    if (!rendererRef.current || !canvasRef.current) return;

    const globalTiles = (window as unknown as Record<string, unknown>).tiles as unknown[];
    const globalMap = (window as unknown as Record<string, unknown>).map;

    console.log('MapCanvas render effect triggered:', {
      globalTilesCount: globalTiles ? globalTiles.length : 0,
      storeTileCount: map ? Object.keys(map.tiles).length : 0,
      unitCount: Object.keys(units).length,
      cityCount: Object.keys(cities).length,
      viewport,
      dataSourceMismatch:
        globalTiles && map ? globalTiles.length !== Object.keys(map.tiles).length : false,
      gotoModeActive: gotoMode.active,
      gotoPath: gotoMode.currentPath ? `${gotoMode.currentPath.tiles.length} tiles` : 'null',
    });

    // Only render if we have the global tiles data that MapRenderer uses
    if (rendererRef.current && globalTiles && globalMap) {
      console.log(
        'Executing render with global tiles count:',
        globalTiles.length,
        'gotoPath:',
        gotoMode.currentPath
      );
      // Render is now synchronous for better performance and no race conditions
      rendererRef.current.render({
        viewport,
        map, // Keep using store map for compatibility, but trigger based on global data
        units,
        cities,
        players,
        selectedUnitId: useGameStore.getState().selectedUnitId,
        focusedUnits: useGameStore.getState().focusedUnits,
        gotoPath: gotoMode.currentPath,
      });
    }
  }, [
    viewport,
    map,
    units,
    cities,
    players,
    focusedUnits,
    gotoMode.active,
    gotoMode.currentPath,
    globalTilesVersion,
  ]); // Include map for React Hook dependency

  // Monitor global tiles changes and trigger canvas reinitialization (like window resize)
  useEffect(() => {
    let lastTilesLength = 0;

    const checkGlobalTiles = () => {
      const globalTiles = (window as unknown as Record<string, unknown>).tiles as unknown[];
      if (globalTiles && globalTiles.length !== lastTilesLength && globalTiles.length > 0) {
        console.log('Global tiles changed, triggering canvas reinitialization:', {
          oldLength: lastTilesLength,
          newLength: globalTiles.length,
        });

        lastTilesLength = globalTiles.length;

        // Force canvas reinitialization like window resize does
        const canvas = canvasRef.current;
        if (canvas && rendererRef.current) {
          // Get current dimensions
          const currentWidth = canvas.width;
          const currentHeight = canvas.height;

          console.log('Forcing canvas context reset:', {
            width: currentWidth,
            height: currentHeight,
          });

          // Force complete canvas context reset by setting dimensions
          // This clears any corrupted rendering state that might cause visual glitches
          canvas.width = currentWidth;
          canvas.height = currentHeight;

          // Reinitialize the renderer context (important!)
          const ctx = canvas.getContext('2d');
          if (ctx) {
            // Reset any canvas context state that might be corrupted
            ctx.imageSmoothingEnabled = false;
            (ctx as unknown as Record<string, unknown>).webkitImageSmoothingEnabled = false;
            (ctx as unknown as Record<string, unknown>).mozImageSmoothingEnabled = false;
            (ctx as unknown as Record<string, unknown>).msImageSmoothingEnabled = false;
            ctx.font = '14px Arial, sans-serif';
          }

          // Update viewport to trigger full re-render
          setViewport({ width: currentWidth, height: currentHeight });

          // Force an immediate render to avoid timing delays after tiles change
          rendererRef.current.render(
            {
              viewport: useGameStore.getState().viewport,
              map: useGameStore.getState().map,
              units: useGameStore.getState().units,
              cities: useGameStore.getState().cities,
              players: useGameStore.getState().players,
              selectedUnitId: useGameStore.getState().selectedUnitId,
              focusedUnits: useGameStore.getState().focusedUnits,
              gotoPath: gotoMode.currentPath,
            },
            true
          ); // immediate flag
        }

        setGlobalTilesVersion(prev => prev + 1);
      }
    };

    // Check periodically for global tiles changes (more stable than event-based)
    const interval = setInterval(checkGlobalTiles, 100); // Check every 100ms

    // Also check immediately
    checkGlobalTiles();

    return () => clearInterval(interval);
  }, [setViewport, gotoMode.currentPath]); // Add dependencies

  // Optimized animation for selection pulsing - use a simple timer instead of continuous animation loop
  useEffect(() => {
    const currentSelectedUnitId = gameState.selectedUnitId;

    // Don't run animation while dragging to prevent conflicts
    if (currentSelectedUnitId && rendererRef.current && !isDragging) {
      // Use setInterval with a reasonable refresh rate to avoid stuttering during scrolling
      const intervalId = setInterval(() => {
        // Double-check we're still not dragging
        if (rendererRef.current && !isDragging) {
          rendererRef.current.render(
            {
              viewport,
              map,
              units,
              cities,
              players,
              selectedUnitId: currentSelectedUnitId,
              focusedUnits,
              gotoPath: gotoMode.currentPath,
            },
            true
          ); // immediate flag for selection animation
        }
      }, 100); // 10fps for smooth pulsing without interfering with scrolling

      return () => {
        clearInterval(intervalId);
        // Force a final render without selection to clear the outline
        if (rendererRef.current) {
          rendererRef.current.render(
            {
              viewport,
              map,
              units,
              cities,
              players,
              selectedUnitId: null,
              focusedUnits,
              gotoPath: gotoMode.currentPath,
            },
            true
          ); // immediate flag to clear selection
        }
      };
    } else if (!isDragging) {
      // Force a render without selection to clear any lingering outline (but not while dragging)
      if (rendererRef.current) {
        rendererRef.current.render(
          {
            viewport,
            map,
            units,
            cities,
            players,
            selectedUnitId: null,
            focusedUnits,
            gotoPath: gotoMode.currentPath,
          },
          true
        ); // immediate flag to clear selection
      }
    }
  }, [
    gameState.selectedUnitId,
    viewport,
    map,
    units,
    cities,
    players,
    focusedUnits,
    gotoMode.currentPath,
    isDragging,
  ]);

  // Drag tracking refs
  const dragStart = useRef({ x: 0, y: 0 });
  const dragStartViewport = useRef(viewport);
  const currentRenderViewport = useRef(viewport);
  const dragStartTime = useRef<number>(0);
  const DRAG_THRESHOLD = 5; // pixels
  const LONG_PRESS_MS = 500; // touch and hold duration to emulate right-click
  const longPressTimeoutRef = useRef<number | null>(null);
  const longPressFiredRef = useRef<boolean>(false);

  // Deactivate goto mode
  const deactivateGotoMode = useCallback(() => {
    // Clear the goto state
    setGotoMode({
      active: false,
      unit: null,
      targetTile: null,
      currentPath: null,
    });

    // Reset cursor
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.cursor = 'crosshair'; // Default canvas cursor
    }
  }, []);

  // Request path for goto mode preview (similar to freeciv-web's check_request_goto_path)
  const requestGotoPath = useCallback(
    async (targetX: number, targetY: number) => {
      if (!gotoMode.unit) return;

      console.log(`Requesting path for unit ${gotoMode.unit.id} to (${targetX}, ${targetY})`);

      try {
        const path = await pathfindingService.requestPath(gotoMode.unit.id, targetX, targetY);

        if (path) {
          setGotoMode(prev => ({
            ...prev,
            targetTile: { x: targetX, y: targetY },
            currentPath: path,
          }));
          console.log('Path received:', path);
        } else {
          console.warn('No valid path found');
          setGotoMode(prev => ({
            ...prev,
            targetTile: { x: targetX, y: targetY },
            currentPath: null,
          }));
        }
      } catch (error) {
        console.error('Error requesting path:', error);
      }
    },
    [gotoMode.unit]
  );

  // Execute goto action when target is selected
  const executeGoto = useCallback(
    async (targetX: number, targetY: number) => {
      if (!gotoMode.unit) return;

      console.log(`Executing goto for unit ${gotoMode.unit.id} to (${targetX}, ${targetY})`);

      try {
        const result = await gameClient.executeUnitAction(
          gotoMode.unit.id,
          ActionType.GOTO,
          targetX,
          targetY
        );

        setActionFeedback({
          success: true,
          message: result.message || `Unit moving to (${targetX}, ${targetY})`,
        });
      } catch (error) {
        console.error('Error executing goto action:', error);
        setActionFeedback({
          success: false,
          message: error instanceof Error ? error.message : 'Go To failed',
        });
      } finally {
        // Always deactivate goto mode after execution attempt (clears path immediately)
        deactivateGotoMode();
        // Deselect the unit after goto destination is clicked
        selectUnit(null);
        setSelectedUnit(null);
      }
    },
    [gotoMode.unit, deactivateGotoMode, selectUnit]
  );

  const executeTargetAction = useCallback(
    async (targetX: number, targetY: number) => {
      if (!targetActionMode) return;
      try {
        const result = await gameClient.executeUnitAction(
          targetActionMode.unit.id,
          targetActionMode.action,
          targetX,
          targetY
        );
        setActionFeedback({
          success: true,
          message: result.message || `${targetActionMode.action.replaceAll('_', ' ')} completed`,
        });
      } catch (error) {
        setActionFeedback({
          success: false,
          message: error instanceof Error ? error.message : 'Targeted action failed',
        });
      } finally {
        setTargetActionMode(null);
      }
    },
    [targetActionMode]
  );

  // City overlay handlers - placed early to avoid dependency issues
  const handleOpenCityInfoOverlay = useCallback(async (city: City) => {
    setCityInfoOverlay({
      isOpen: true,
      city: city,
    });

    // Load production data
    setProductionData({
      availableProductions: [],
      isLoading: true,
      cityId: city.id,
    });

    try {
      const productions = await gameClient.getAvailableProductions(city.id);
      setProductionData({
        availableProductions: productions,
        isLoading: false,
        cityId: city.id,
      });
    } catch (error) {
      console.error('Failed to load production data:', error);
      setProductionData({
        availableProductions: [],
        isLoading: false,
        cityId: city.id,
      });
    }
  }, []);

  const handleCloseCityInfoOverlay = useCallback(() => {
    setCityInfoOverlay({
      isOpen: false,
      city: null,
    });
    setProductionData({
      availableProductions: [],
      isLoading: false,
      cityId: null,
    });
  }, []);

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
        const tileX = Math.floor(mapPos.mapX);
        const tileY = Math.floor(mapPos.mapY);

        // If in goto mode, request path for hovered tile
        if (gotoMode.active && gotoMode.unit) {
          // Only request path if hovering a different tile
          if (
            !gotoMode.targetTile ||
            gotoMode.targetTile.x !== tileX ||
            gotoMode.targetTile.y !== tileY
          ) {
            requestGotoPath(tileX, tileY);
          }
        }

        // Standard tile hover for tooltip
        const globalTiles = (window as { tiles?: Array<{ x: number; y: number; terrain: string }> })
          .tiles;

        if (globalTiles) {
          // Find the tile at the mouse position
          const hoveredTileData = globalTiles.find(
            tile => tile && Math.floor(tile.x) === tileX && Math.floor(tile.y) === tileY
          );

          if (hoveredTileData && hoveredTileData.terrain) {
            // Format terrain name to be human readable
            const terrainName = hoveredTileData.terrain
              .replace(/_/g, ' ')
              .replace(/\b\w/g, (l: string) => l.toUpperCase());

            // In goto mode, show path info if available
            let hoverText = `${terrainName} (${tileX}, ${tileY})`;
            if (gotoMode.active && gotoMode.currentPath) {
              hoverText += ` - ${gotoMode.currentPath.estimatedTurns} turns, ${gotoMode.currentPath.totalCost} movement`;
            }

            setHoveredTile(hoverText);
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
          rendererRef.current.render(
            {
              viewport: newViewport,
              map: useGameStore.getState().map,
              units: useGameStore.getState().units,
              cities: useGameStore.getState().cities,
              players: useGameStore.getState().players,
              selectedUnitId: useGameStore.getState().selectedUnitId,
              focusedUnits: useGameStore.getState().focusedUnits,
              gotoPath: gotoMode.currentPath,
            },
            true
          ); // immediate flag for drag updates
        }
      });
    },
    [
      isDragging,
      viewport,
      gotoMode.active,
      gotoMode.unit,
      gotoMode.targetTile,
      requestGotoPath,
      gotoMode.currentPath,
    ]
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
        // Handle click (not drag)
        const mapPos = rendererRef.current.canvasToMap(canvasX, canvasY, viewport);
        const tileX = Math.floor(mapPos.mapX);
        const tileY = Math.floor(mapPos.mapY);

        // If in goto mode, execute goto to clicked tile
        if (gotoMode.active) {
          executeGoto(tileX, tileY);
          // Reset drag tracking even when executing goto
          dragStartTime.current = 0;
          return;
        }
        if (targetActionMode) {
          void executeTargetAction(tileX, tileY);
          dragStartTime.current = 0;
          return;
        }

        // Enhanced unit selection with multi-select support
        const clickOptions: ClickOptions = {
          shiftKey: event.shiftKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          button: event.button,
          isGotoMode: false,
        };

        // Check click cooldown to prevent rapid clicking
        if (
          shouldIgnoreClick(lastClickTime.current, lastClickTile.current, { x: tileX, y: tileY })
        ) {
          dragStartTime.current = 0;
          return;
        }

        const unitsAtTile = getUnitsAtTile(units, tileX, tileY);
        const clickResult = determineMapClickAction(
          tileX,
          tileY,
          unitsAtTile,
          currentPlayerId,
          focusedUnits,
          clickOptions
        );

        // Update click tracking
        lastClickTime.current = Date.now();
        lastClickTile.current = { x: tileX, y: tileY };

        // Handle the click result
        switch (clickResult.action) {
          case 'select':
            if (clickResult.unitIds.length > 0) {
              selectUnit(clickResult.unitIds[0]);
              setSelectedUnit(units[clickResult.unitIds[0]] as Unit);
            } else {
              selectUnit(null);
              setSelectedUnit(null);
            }
            break;

          case 'focus':
            if (clickResult.unitIds.length > 0) {
              addToFocus(clickResult.unitIds[0], true);
              setSelectedUnit(units[clickResult.unitIds[0]] as Unit);
            }
            break;

          case 'none':
            // No action needed
            break;
        }
      }

      // Reset drag tracking
      dragStartTime.current = 0;
    },
    [
      isDragging,
      setViewport,
      selectUnit,
      addToFocus,
      units,
      viewport,
      gotoMode.active,
      executeGoto,
      targetActionMode,
      executeTargetAction,
      currentPlayerId,
      focusedUnits,
    ]
  );

  // Touch event handlers for mobile panning + actions
  const handleTouchStart = useCallback(
    (event: React.TouchEvent<HTMLCanvasElement>) => {
      if (event.touches.length !== 1) return; // Only handle single touch

      const canvas = canvasRef.current;
      if (!canvas) return;

      const touch = event.touches[0];
      const rect = canvas.getBoundingClientRect();
      const canvasX = touch.clientX - rect.left;
      const canvasY = touch.clientY - rect.top;

      // Close any open context menu
      setContextMenu(null);

      // Prepare drag like mouse: don't set dragging until we move beyond threshold
      setIsDragging(false);
      dragStart.current = { x: canvasX, y: canvasY };
      dragStartViewport.current = viewport;
      currentRenderViewport.current = viewport;
      dragStartTime.current = Date.now();

      longPressFiredRef.current = false;
      // Schedule long-press to emulate right click/context menu
      if (longPressTimeoutRef.current) {
        window.clearTimeout(longPressTimeoutRef.current);
      }
      longPressTimeoutRef.current = window.setTimeout(() => {
        // If finger hasn't moved far, trigger long-press
        const movedDistance = Math.hypot(
          dragStart.current.x - (touch.clientX - rect.left),
          dragStart.current.y - (touch.clientY - rect.top)
        );
        if (movedDistance <= DRAG_THRESHOLD) {
          longPressFiredRef.current = true;

          // If in goto mode, emulate right-click -> cancel goto
          if (gotoMode.active) {
            deactivateGotoMode();
          } else if (rendererRef.current) {
            // Open unit context menu or city info at touch position
            const mapPos = rendererRef.current.canvasToMap(canvasX, canvasY, viewport);
            const tileX = Math.floor(mapPos.mapX);
            const tileY = Math.floor(mapPos.mapY);

            const unitAtPosition = Object.values(units).find(
              unit => unit.x === tileX && unit.y === tileY
            );
            const cityAtPosition = Object.values(cities).find(
              city => city.x === tileX && city.y === tileY
            );

            if (unitAtPosition) {
              setContextMenu({
                unit: unitAtPosition as Unit,
                position: { x: touch.clientX, y: touch.clientY },
              });
              selectUnit(unitAtPosition.id);
              setSelectedUnit(unitAtPosition as Unit);
            } else if (cityAtPosition) {
              handleOpenCityInfoOverlay(cityAtPosition as City);
            }
          }
        }
      }, LONG_PRESS_MS);

      // Prevent default to avoid page scrolling
      event.preventDefault();
    },
    [
      viewport,
      gotoMode.active,
      deactivateGotoMode,
      units,
      cities,
      selectUnit,
      handleOpenCityInfoOverlay,
    ]
  );

  const handleTouchMove = useCallback(
    (event: React.TouchEvent<HTMLCanvasElement>) => {
      if (!rendererRef.current || event.touches.length !== 1) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const touch = event.touches[0];
      const rect = canvas.getBoundingClientRect();
      const canvasX = touch.clientX - rect.left;
      const canvasY = touch.clientY - rect.top;

      // Decide if we should start dragging
      if (!isDragging) {
        const dragDistance = Math.hypot(
          canvasX - dragStart.current.x,
          canvasY - dragStart.current.y
        );
        if (dragDistance > DRAG_THRESHOLD) {
          setIsDragging(true);
          // Cancel long-press if we start dragging
          if (longPressTimeoutRef.current) {
            window.clearTimeout(longPressTimeoutRef.current);
            longPressTimeoutRef.current = null;
          }
        }
      }

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

      if (isDragging) {
        // Directly render without any state updates during drag
        requestAnimationFrame(() => {
          if (rendererRef.current) {
            rendererRef.current.render(
              {
                viewport: newViewport,
                map: useGameStore.getState().map,
                units: useGameStore.getState().units,
                cities: useGameStore.getState().cities,
                players: useGameStore.getState().players,
                selectedUnitId: useGameStore.getState().selectedUnitId,
                focusedUnits: useGameStore.getState().focusedUnits,
                gotoPath: gotoMode.currentPath,
              },
              true
            ); // immediate flag for touch drag
          }
        });
      } else {
        // Not dragging: if in goto mode, show live path preview under finger
        if (gotoMode.active) {
          const mapPos = rendererRef.current.canvasToMap(canvasX, canvasY, viewport);
          const tileX = Math.floor(mapPos.mapX);
          const tileY = Math.floor(mapPos.mapY);
          if (
            !gotoMode.targetTile ||
            gotoMode.targetTile.x !== tileX ||
            gotoMode.targetTile.y !== tileY
          ) {
            requestGotoPath(tileX, tileY);
          }
        }
      }

      // Prevent default to avoid page scrolling
      event.preventDefault();
    },
    [
      isDragging,
      gotoMode.currentPath,
      gotoMode.active,
      gotoMode.targetTile,
      requestGotoPath,
      viewport,
    ]
  );

  const handleTouchEnd = useCallback(
    (event: React.TouchEvent<HTMLCanvasElement>) => {
      if (longPressTimeoutRef.current) {
        window.clearTimeout(longPressTimeoutRef.current);
        longPressTimeoutRef.current = null;
      }

      if (!rendererRef.current) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      // Use changedTouches if available; fallback to touches (ended)
      const touch = (event.changedTouches && event.changedTouches[0]) || undefined;

      // If we were dragging, finish the drag similar to mouse
      if (isDragging) {
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
      } else if (!longPressFiredRef.current && dragStartTime.current > 0) {
        // Treat as a tap/click
        const tapClientX = touch ? touch.clientX : dragStart.current.x + rect.left;
        const tapClientY = touch ? touch.clientY : dragStart.current.y + rect.top;
        const canvasX = tapClientX - rect.left;
        const canvasY = tapClientY - rect.top;

        const mapPos = rendererRef.current.canvasToMap(canvasX, canvasY, viewport);
        const tileX = Math.floor(mapPos.mapX);
        const tileY = Math.floor(mapPos.mapY);

        if (gotoMode.active) {
          // Show path briefly, then execute goto
          requestGotoPath(tileX, tileY);
          window.setTimeout(() => {
            executeGoto(tileX, tileY);
          }, 150);
        } else if (targetActionMode) {
          void executeTargetAction(tileX, tileY);
        } else {
          // Normal selection
          const unitAtPosition = Object.values(units).find(
            unit => unit.x === tileX && unit.y === tileY
          );

          if (unitAtPosition) {
            selectUnit(unitAtPosition.id);
            setSelectedUnit(unitAtPosition as Unit);
          } else {
            selectUnit(null);
            setSelectedUnit(null);
          }
        }
      }

      // Reset drag tracking and long-press state
      dragStartTime.current = 0;
      longPressFiredRef.current = false;

      // Prevent default to avoid unwanted synthetic mouse events
      event.preventDefault();
    },
    [
      isDragging,
      setViewport,
      viewport,
      gotoMode.active,
      requestGotoPath,
      executeGoto,
      targetActionMode,
      executeTargetAction,
      selectUnit,
      units,
    ]
  );

  // Cleanup any pending long-press timer on unmount
  useEffect(() => {
    return () => {
      if (longPressTimeoutRef.current) {
        window.clearTimeout(longPressTimeoutRef.current);
        longPressTimeoutRef.current = null;
      }
    };
  }, []);

  // Handle right-click context menu
  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      event.preventDefault(); // Prevent browser context menu

      // If in goto mode, right-click cancels it
      if (gotoMode.active) {
        console.log('Right-click - deactivating goto mode');
        deactivateGotoMode();
        return;
      }
      if (targetActionMode) {
        setTargetActionMode(null);
        return;
      }

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
        unit => unit.x === tileX && unit.y === tileY
      );

      // Find city at right-clicked position
      const cityAtPosition = Object.values(cities).find(
        city => city.x === tileX && city.y === tileY
      );

      if (unitAtPosition) {
        // Show context menu for the unit
        setContextMenu({
          unit: unitAtPosition as Unit,
          position: { x: event.clientX, y: event.clientY },
        });
        selectUnit(unitAtPosition.id);
        setSelectedUnit(unitAtPosition as Unit);
      } else if (cityAtPosition) {
        // Show info overlay for the city
        handleOpenCityInfoOverlay(cityAtPosition as City);
      }
    },
    [
      selectUnit,
      units,
      cities,
      viewport,
      gotoMode.active,
      deactivateGotoMode,
      handleOpenCityInfoOverlay,
      targetActionMode,
    ]
  );

  // Handle unit action selection
  const handleActionSelect = useCallback(
    async (action: ActionType, targetX?: number, targetY?: number) => {
      if (!selectedUnit) return;

      // Special handling for GOTO action - enter interactive mode
      if (action === ActionType.GOTO) {
        console.log(`Activating goto mode for unit ${selectedUnit.id}`);
        setGotoMode({
          active: true,
          unit: selectedUnit,
          targetTile: null,
          currentPath: null,
        });
        // Change cursor to indicate goto mode is active
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.style.cursor = 'crosshair';
        }
        return;
      }

      // Special handling for FOUND_CITY action - open city naming dialog
      if (action === ActionType.FOUND_CITY) {
        console.log(`Opening city naming dialog for unit ${selectedUnit.id}`);
        setCityNameDialog({
          isOpen: true,
          unit: selectedUnit,
        });
        // Close context menu since we're opening the dialog
        setContextMenu(null);
        return;
      }

      if (action === ActionType.TRADE_ROUTE) {
        setTargetActionMode({ unit: selectedUnit, action });
        setActionFeedback({
          success: true,
          message: 'Select the destination city for this trade route',
        });
        return;
      }

      console.log(`Selected action ${action} for unit ${selectedUnit.id}`, {
        unitId: selectedUnit.id,
        action,
        targetX,
        targetY,
      });

      // Send action to server via GameClient for immediate actions
      try {
        const result = await gameClient.executeUnitAction(
          selectedUnit.id,
          action,
          targetX,
          targetY
        );

        setActionFeedback({
          success: true,
          message: result.message || `${action.replaceAll('_', ' ')} completed`,
        });
      } catch (error) {
        console.error(`Error executing unit action:`, error);
        setActionFeedback({
          success: false,
          message: error instanceof Error ? error.message : `${action} failed`,
        });
      }
    },
    [selectedUnit]
  );

  // Close context menu when clicking elsewhere
  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Handle city naming dialog
  const handleCloseCityNameDialog = useCallback(() => {
    setCityNameDialog({
      isOpen: false,
      unit: null,
    });
  }, []);

  const handleFoundCity = useCallback(
    async (cityName: string) => {
      if (!cityNameDialog.unit) return;

      console.log(`Founding city "${cityName}" with unit ${cityNameDialog.unit.id}`);

      try {
        // Use the promise-based foundCity method for proper error handling
        const cityId = await gameClient.foundCityWithUnit(
          cityNameDialog.unit.id,
          cityName,
          cityNameDialog.unit.x,
          cityNameDialog.unit.y
        );

        console.log(`Successfully founded city: ${cityName} (ID: ${cityId})`);
        // Deselect the unit since it will be destroyed after founding the city
        selectUnit(null);
        setSelectedUnit(null);
      } catch (error) {
        console.error('Error founding city:', error);
        throw error; // Re-throw so dialog can handle loading state
      }
    },
    [cityNameDialog.unit, selectUnit]
  );

  const handleProductionChange = useCallback(
    async (cityId: string, productionId: string, type: 'unit' | 'building' | 'wonder') => {
      console.log('Production change:', { cityId, productionId, type });
      try {
        await gameClient.changeProduction(cityId, productionId, type);
        setActionFeedback({ success: true, message: 'Production updated' });
      } catch (error) {
        console.error('Failed to change production:', error);
        setActionFeedback({
          success: false,
          message: error instanceof Error ? error.message : 'Production change failed',
        });
      }
    },
    []
  );

  // Global keyboard handler for ESC key to exit goto mode
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (gotoMode.active || targetActionMode)) {
        if (gotoMode.active) deactivateGotoMode();
        setTargetActionMode(null);
        event.preventDefault();
        event.stopPropagation();
      }
    };

    if (gotoMode.active || targetActionMode) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [gotoMode.active, targetActionMode, deactivateGotoMode]);

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
      {actionFeedback && (
        <div
          role="status"
          aria-live="polite"
          className={`absolute left-1/2 top-3 z-[1100] -translate-x-1/2 rounded px-3 py-2 text-sm font-medium shadow ${
            actionFeedback.success ? 'bg-green-700 text-white' : 'bg-red-700 text-white'
          }`}
        >
          {actionFeedback.message}
        </div>
      )}
      {targetActionMode && (
        <div className="absolute right-3 top-3 z-[1100] rounded bg-amber-700 px-3 py-2 text-sm text-white shadow">
          Select a target city · Esc to cancel
        </div>
      )}
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
      {contextMenu && (
        <UnitContextMenu
          unit={contextMenu.unit}
          position={contextMenu.position}
          onClose={handleCloseContextMenu}
          onActionSelect={handleActionSelect}
        />
      )}

      <CityNameDialog
        isOpen={cityNameDialog.isOpen}
        unit={cityNameDialog.unit}
        onClose={handleCloseCityNameDialog}
        onFoundCity={handleFoundCity}
      />

      <CityInfoOverlay
        city={cityInfoOverlay.city}
        isOpen={cityInfoOverlay.isOpen}
        onClose={handleCloseCityInfoOverlay}
        units={units}
        availableProductions={productionData.availableProductions}
        isLoadingProductions={productionData.isLoading}
        onProductionChange={handleProductionChange}
        onGovernorChange={(cityId, config) => gameClient.configureCityGovernor(cityId, config)}
        onOptimizeCitizens={cityId => gameClient.optimizeCityCitizens(cityId)}
        onBuyProduction={async cityId => {
          const result = await gameClient.buyCityProduction(cityId);
          setActionFeedback({
            success: true,
            message: `Spent ${result.goldSpent} gold${
              result.completed ? '; production completed' : ''
            }`,
          });
        }}
      />
    </div>
  );
};
