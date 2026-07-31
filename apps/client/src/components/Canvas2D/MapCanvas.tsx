import React, { useRef, useEffect, useCallback, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { MapRenderer } from './MapRenderer';
import { ActionFeedbackBanner, type ActionFeedback } from './ActionFeedbackBanner';
import { UnitContextMenu } from '../GameUI/UnitContextMenu';
import { CityNameDialog } from '../GameUI/CityNameDialog';
import { CityInfoOverlay } from '../GameUI/CityInfoOverlay';
import type { Unit, City, ProductionOption, MapViewport } from '../../types';
import { ActionType } from '../../types/shared/actions';
import { gameClient } from '../../services/GameClient';
import { pathfindingService, type GotoPath } from '../../services/PathfindingService';
import {
  determineMapClickAction,
  getUnitsAtTile,
  shouldIgnoreClick,
  type ClickOptions,
} from '../../utils/mapInteraction';
import {
  loadUserPreferences,
  USER_PREFERENCES_CHANGED_EVENT,
  type UserPreferences,
} from '../../services/UserPreferences';
import { findInitialMapCenter } from '../../utils/initialMapCenter';
import { shallow } from 'zustand/shallow';

interface MapCanvasProps {
  width: number;
  height: number;
  rulesetName?: string;
}

export const MapCanvas: React.FC<MapCanvasProps> = ({
  width,
  height,
  rulesetName = 'civ2civ3',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const [rendererReady, setRendererReady] = useState(false);
  const [movementRange, setMovementRange] = useState<
    import('../../services/PathfindingService').AccessibleTile[]
  >([]);
  const [fogOfWarEnabled, setFogOfWarEnabled] = useState(
    () => !loadUserPreferences().disableFogOfWar
  );

  // Track initial centering to prevent multiple centering events (freeciv-web compliance)
  const [hasInitiallyCentered, setHasInitiallyCentered] = useState(false);

  // Unit selection and context menu state
  const [selectedUnit, setSelectedUnit] = useState<Unit | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    unit: Unit;
    position: { x: number; y: number };
  } | null>(null);
  const [actionFeedback, setActionFeedback] = useState<ActionFeedback | null>(null);
  const dismissActionFeedback = useCallback(() => setActionFeedback(null), []);

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
    error: string | null;
  }>({
    availableProductions: [],
    isLoading: false,
    cityId: null,
    error: null,
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

  const viewport = useGameStore(state => state.viewport);
  const map = useGameStore(state => state.map);
  const units = useGameStore(state => state.units);
  const cities = useGameStore(state => state.cities);
  const currentPlayerId = useGameStore(state => state.currentPlayerId);
  const currentGameId = useGameStore(state => state.currentGameId);
  const focusedUnits = useGameStore(state => state.focusedUnits);
  const selectedUnitId = useGameStore(state => state.selectedUnitId);
  const mapData = useGameStore(state => state.mapData);
  const hasReceivedUnitSnapshot = useGameStore(state => state.hasReceivedUnitSnapshot);
  const setViewport = useGameStore(state => state.setViewport);
  const selectUnit = useGameStore(state => state.selectUnit);
  const selectCity = useGameStore(state => state.selectCity);
  const addToFocus = useGameStore(state => state.addToFocus);

  useEffect(() => {
    const unit = selectedUnitId ? units[selectedUnitId] : undefined;
    if (!unit || unit.playerId !== currentPlayerId || unit.movesLeft <= 0 || unit.doneMoving) {
      setMovementRange([]);
      return;
    }

    let active = true;
    setMovementRange([]);
    pathfindingService.requestMovementRange(unit.id).then(tiles => {
      if (active) setMovementRange(tiles ?? []);
    });
    return () => {
      active = false;
    };
  }, [currentPlayerId, selectedUnitId, units]);

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

    const handleActivateTargetAction = (event: CustomEvent) => {
      const { unit, action } = event.detail;
      if (!unit || !action) return;
      setSelectedUnit(unit);
      selectUnit(unit.id);
      setTargetActionMode({ unit, action });
      setActionFeedback({
        success: true,
        message:
          action === ActionType.PATROL
            ? 'Select the other endpoint of this patrol route'
            : 'Select a target tile',
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
    document.addEventListener(
      'activate-target-action-mode',
      handleActivateTargetAction as EventListener
    );
    document.addEventListener('show-action-dialog', handleShowActionDialog as EventListener);
    document.addEventListener('show-city-name-dialog', handleShowCityNameDialog as EventListener);

    return () => {
      document.removeEventListener('activate-goto-mode', handleActivateGoto as EventListener);
      document.removeEventListener(
        'activate-target-action-mode',
        handleActivateTargetAction as EventListener
      );
      document.removeEventListener('show-action-dialog', handleShowActionDialog as EventListener);
      document.removeEventListener(
        'show-city-name-dialog',
        handleShowCityNameDialog as EventListener
      );
    };
  }, [focusedUnits, selectUnit, setGotoMode]);

  // Handle mouse and touch events - copied from freeciv-web 2D canvas behavior
  const [isDragging, setIsDragging] = useState(false);

  // Initialize renderer and load tileset - only once, not on viewport changes!
  useEffect(() => {
    let cancelled = false;
    let renderer: MapRenderer | null = null;

    const initRenderer = async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      renderer = new MapRenderer(ctx, undefined, rulesetName);
      rendererRef.current = renderer;

      try {
        // Initialize renderer (tileset files are now served from client domain)
        await renderer.initialize();
        if (cancelled) {
          renderer.cleanup();
          return;
        }

        setRendererReady(true);
        const gameState = useGameStore.getState();

        if (rendererRef.current === renderer) {
          renderer.render({
            viewport: gameState.viewport,
            map: gameState.map,
            units: gameState.units,
            cities: gameState.cities,
            players: gameState.players,
            selectedUnitId: gameState.selectedUnitId,
            focusedUnits: gameState.focusedUnits,
            currentPlayerId: gameState.currentPlayerId,
            researchedTechs: gameState.research?.researchedTechs,
          });
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to initialize MapRenderer:', error);
        }
      }
    };

    void initRenderer();

    return () => {
      cancelled = true;
      renderer?.cleanup();
      if (rendererRef.current === renderer) {
        rendererRef.current = null;
      }
    };
  }, [rulesetName]);

  useEffect(() => {
    const handlePreferencesChanged = (event: Event) => {
      const preferences = (event as CustomEvent<UserPreferences>).detail;
      setFogOfWarEnabled(!preferences.disableFogOfWar);
      if (import.meta.env.DEV) {
        void gameClient.setDebugVisibility(preferences.disableFogOfWar).catch(() => {
          // The settings panel reports debug visibility errors when it is open.
        });
      }
    };

    document.addEventListener(USER_PREFERENCES_CHANGED_EVENT, handlePreferencesChanged);
    return () =>
      document.removeEventListener(USER_PREFERENCES_CHANGED_EVENT, handlePreferencesChanged);
  }, []);

  // Restore the saved debug visibility preference during normal game startup.
  // Previously this only ran when the Settings dialog mounted, which made a
  // reload show the fogged server snapshot until the dialog was opened.
  useEffect(() => {
    if (!import.meta.env.DEV || !currentGameId || !hasReceivedUnitSnapshot) return;

    const preferences = loadUserPreferences();
    void gameClient.setDebugVisibility(preferences.disableFogOfWar).catch(() => {
      // Debug visibility is optional and should not interrupt map rendering.
    });
  }, [currentGameId, hasReceivedUnitSnapshot]);

  useEffect(() => {
    const handleCenterMap = (event: Event) => {
      const detail = (event as CustomEvent<{ x?: number; y?: number }>).detail;
      if (detail.x === undefined || detail.y === undefined || !rendererRef.current) return;
      const centered = rendererRef.current.getViewportPositionForTile(
        detail.x,
        detail.y,
        width,
        height
      );
      const constrained = rendererRef.current.setMapviewOrigin(
        centered.x,
        centered.y,
        width,
        height
      );
      setViewport({ ...constrained, width, height });
    };

    document.addEventListener('center-map-on-tile', handleCenterMap);
    return () => document.removeEventListener('center-map-on-tile', handleCenterMap);
  }, [height, setViewport, width]);

  useEffect(() => {
    rendererRef.current?.setFogOfWarEnabled(fogOfWarEnabled);
  }, [fogOfWarEnabled]);

  const renderLatestSnapshot = useCallback(
    (viewportOverride?: MapViewport, immediate = false) => {
      const renderer = rendererRef.current;
      if (!renderer) return;

      // Read the store once so a redraw cannot mix entities from one state
      // revision with the viewport from another.
      const state = useGameStore.getState();
      renderer.render(
        {
          viewport: viewportOverride ?? state.viewport,
          map: state.map,
          units: state.units,
          cities: state.cities,
          players: state.players,
          selectedUnitId: state.selectedUnitId,
          selectedCityId: state.selectedCityId,
          focusedUnits: state.focusedUnits,
          urgentFocusQueue: state.urgentFocusQueue,
          gotoPath: gotoMode.currentPath,
          movementRange,
          movementRangeOrigin: state.selectedUnitId
            ? state.units[state.selectedUnitId]
              ? { x: state.units[state.selectedUnitId].x, y: state.units[state.selectedUnitId].y }
              : undefined
            : undefined,
          currentPlayerId: state.currentPlayerId,
          researchedTechs: state.research?.researchedTechs,
        },
        immediate
      );
    },
    [gotoMode.currentPath, movementRange]
  );

  // Update canvas size
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Setting either dimension clears the backing buffer. React may replay
    // this effect with the same dimensions during a warm route transition.
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

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

    const mapWidth = map.xsize ?? map.width;
    const mapHeight = map.ysize ?? map.height;
    if (!rendererRef.current || !mapWidth || !mapHeight) {
      return;
    }

    const startTile = findInitialMapCenter({
      mapData,
      currentPlayerId,
      units,
      cities,
      tiles: map.tiles,
      hasReceivedUnitSnapshot,
    });

    if (startTile && rendererRef.current) {
      // The viewport store still contains its 800x600 defaults during this
      // effect's first pass. Use the current canvas props so startup centering
      // cannot race the size synchronization effect above.
      const centeredViewport = rendererRef.current.getViewportPositionForTile(
        startTile.x,
        startTile.y,
        width,
        height
      );

      setViewport({
        x: centeredViewport.x,
        y: centeredViewport.y,
        width,
        height,
      });

      // Mark as initially centered to prevent future centering
      setHasInitiallyCentered(true);
      console.log('Initial camera centering completed');
    }
  }, [
    // Minimal dependencies to reduce race conditions
    mapData,
    currentPlayerId,
    map,
    hasInitiallyCentered,
    // Use extracted variables instead of complex expressions
    unitsCount,
    citiesCount,
    hasReceivedUnitSnapshot,
    setViewport,
    cities,
    units,
    width,
    height,
  ]);

  // Draw store changes directly; React remains responsible for interaction UI.
  useEffect(() => {
    if (!rendererReady || !rendererRef.current || !canvasRef.current) return;

    renderLatestSnapshot();
    return useGameStore.subscribe(
      state =>
        [
          state.viewport,
          state.map,
          state.units,
          state.cities,
          state.players,
          state.selectedUnitId,
          state.selectedCityId,
          state.focusedUnits,
          state.urgentFocusQueue,
          state.currentPlayerId,
          state.research?.researchedTechs,
        ] as const,
      () => renderLatestSnapshot(),
      { equalityFn: shallow }
    );
  }, [renderLatestSnapshot, rendererReady]);

  // Optimized animation for selection pulsing - use a simple timer instead of continuous animation loop
  useEffect(() => {
    // Don't run animation while dragging to prevent conflicts
    if (selectedUnitId && rendererRef.current && !isDragging) {
      // Use setInterval with a reasonable refresh rate to avoid stuttering during scrolling
      const intervalId = setInterval(() => {
        renderLatestSnapshot(undefined, true);
      }, 100); // 10fps for smooth pulsing without interfering with scrolling

      return () => {
        clearInterval(intervalId);
        // Redraw from the current store revision. Rendering captured React
        // values here could restore units or a viewport from the prior effect.
        renderLatestSnapshot(undefined, true);
      };
    } else if (!isDragging) {
      renderLatestSnapshot(undefined, true);
    }
  }, [selectedUnitId, isDragging, renderLatestSnapshot]);

  // Drag tracking refs
  const dragStart = useRef({ x: 0, y: 0 });
  const dragStartViewport = useRef(viewport);
  const currentRenderViewport = useRef(viewport);
  const dragRenderFrame = useRef<number | null>(null);
  const dragStartTime = useRef<number>(0);
  const DRAG_THRESHOLD = 5; // pixels
  const LONG_PRESS_MS = 500; // touch and hold duration to emulate right-click
  const longPressTimeoutRef = useRef<number | null>(null);
  const longPressFiredRef = useRef<boolean>(false);

  const scheduleDragRender = useCallback(
    (nextViewport: MapViewport) => {
      currentRenderViewport.current = nextViewport;
      if (dragRenderFrame.current !== null) {
        cancelAnimationFrame(dragRenderFrame.current);
      }
      dragRenderFrame.current = requestAnimationFrame(() => {
        dragRenderFrame.current = null;
        renderLatestSnapshot(currentRenderViewport.current, true);
      });
    },
    [renderLatestSnapshot]
  );

  useEffect(
    () => () => {
      if (dragRenderFrame.current !== null) {
        cancelAnimationFrame(dragRenderFrame.current);
      }
    },
    []
  );

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
  const handleOpenCityInfoOverlay = useCallback(
    async (city: City) => {
      selectCity(city.id);
      setCityInfoOverlay({
        isOpen: true,
        city: city,
      });

      // Load production data
      setProductionData({
        availableProductions: [],
        isLoading: true,
        cityId: city.id,
        error: null,
      });

      try {
        const productions = await gameClient.getAvailableProductions(city.id);
        setProductionData({
          availableProductions: productions,
          isLoading: false,
          cityId: city.id,
          error: null,
        });
      } catch (error) {
        console.error('Failed to load production data:', error);
        setProductionData({
          availableProductions: [],
          isLoading: false,
          cityId: city.id,
          error: error instanceof Error ? error.message : 'Failed to load production choices',
        });
      }
    },
    [selectCity]
  );

  const handleCloseCityInfoOverlay = useCallback(() => {
    selectCity(null);
    setCityInfoOverlay({
      isOpen: false,
      city: null,
    });
    setProductionData({
      availableProductions: [],
      isLoading: false,
      cityId: null,
      error: null,
    });
  }, [selectCity]);

  useEffect(() => {
    const handleShowCityInfo = (event: Event) => {
      const city = (event as CustomEvent<{ city?: City; cityId?: string }>).detail?.city;
      const cityId = (event as CustomEvent<{ city?: City; cityId?: string }>).detail?.cityId;
      const targetCity = city ?? (cityId ? cities[cityId] : undefined);
      if (targetCity) void handleOpenCityInfoOverlay(targetCity);
    };

    document.addEventListener('show-city-info', handleShowCityInfo);
    return () => document.removeEventListener('show-city-info', handleShowCityInfo);
  }, [cities, handleOpenCityInfoOverlay]);

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

      // Coalesce pointer events to one frame and render one atomic snapshot.
      scheduleDragRender(newViewport);
    },
    [
      isDragging,
      viewport,
      gotoMode.active,
      gotoMode.unit,
      gotoMode.targetTile,
      requestGotoPath,
      scheduleDragRender,
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

      if (isDragging) {
        scheduleDragRender(newViewport);
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
      gotoMode.active,
      gotoMode.targetTile,
      requestGotoPath,
      viewport,
      scheduleDragRender,
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

      if (
        [
          ActionType.TRADE_ROUTE,
          ActionType.ESTABLISH_EMBASSY,
          ActionType.INVESTIGATE_CITY,
          ActionType.STEAL_TECH,
          ActionType.SABOTAGE_CITY,
          ActionType.BRIBE_UNIT,
          ActionType.INCITE_CITY,
          ActionType.POISON_WATER,
          ActionType.SABOTAGE_UNIT,
          ActionType.PARADROP,
          ActionType.BOMBARD,
          ActionType.NUCLEAR_EXPLOSION,
          ActionType.COLLECT_RANSOM,
          ActionType.SUICIDE_ATTACK,
          ActionType.AIRLIFT,
          ActionType.MARKETPLACE,
          ActionType.HELP_WONDER,
          ActionType.JOIN_CITY,
          ActionType.CHANGE_HOME_CITY,
          ActionType.DISBAND_UNIT_RECOVER,
          ActionType.PATROL,
        ].includes(action)
      ) {
        setTargetActionMode({ unit: selectedUnit, action });
        setActionFeedback({
          success: true,
          message:
            action === ActionType.TRADE_ROUTE
              ? 'Select the destination city for this trade route'
              : action === ActionType.PATROL
                ? 'Select the other endpoint of this patrol route'
                : action === ActionType.MARKETPLACE
                  ? 'Select the city where these goods will be sold'
                  : action === ActionType.HELP_WONDER
                    ? 'Select a friendly city building a Great Wonder'
                    : [
                          ActionType.JOIN_CITY,
                          ActionType.CHANGE_HOME_CITY,
                          ActionType.DISBAND_UNIT_RECOVER,
                        ].includes(action)
                      ? 'Select the friendly city under this unit'
                      : action === ActionType.AIRLIFT
                        ? 'Select a friendly city with an unused airport'
                        : action === ActionType.PARADROP
                          ? 'Select a paradrop destination'
                          : action === ActionType.BOMBARD
                            ? 'Select a tile containing enemy units'
                            : action === ActionType.NUCLEAR_EXPLOSION
                              ? 'Select the nuclear blast center'
                              : [ActionType.COLLECT_RANSOM, ActionType.SUICIDE_ATTACK].includes(
                                    action
                                  )
                                ? 'Select an adjacent enemy unit'
                                : [ActionType.BRIBE_UNIT, ActionType.SABOTAGE_UNIT].includes(action)
                                  ? 'Select an adjacent foreign unit'
                                  : 'Select an adjacent foreign city',
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
      <ActionFeedbackBanner feedback={actionFeedback} onDismiss={dismissActionFeedback} />
      {targetActionMode && (
        <div className="absolute right-3 top-3 z-[1100] rounded bg-amber-700 px-3 py-2 text-sm text-white shadow">
          Select a target · Esc to cancel
        </div>
      )}
      <canvas
        ref={canvasRef}
        aria-label="World map"
        data-renderer-ready={rendererReady}
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
        city={
          cityInfoOverlay.city ? (cities[cityInfoOverlay.city.id] ?? cityInfoOverlay.city) : null
        }
        isOpen={cityInfoOverlay.isOpen}
        onClose={handleCloseCityInfoOverlay}
        units={units}
        availableProductions={productionData.availableProductions}
        isLoadingProductions={productionData.isLoading}
        productionError={productionData.error}
        onRetryProductions={() => {
          const city = cityInfoOverlay.city
            ? (cities[cityInfoOverlay.city.id] ?? cityInfoOverlay.city)
            : null;
          if (city) void handleOpenCityInfoOverlay(city);
        }}
        onProductionChange={handleProductionChange}
        onQueueAdd={(cityId, productionId, type) =>
          gameClient.addCityWorklistItem(cityId, productionId, type)
        }
        onQueueRemove={(cityId, index) => gameClient.removeCityWorklistItem(cityId, index)}
        onQueueReorder={(cityId, fromIndex, toIndex) =>
          gameClient.reorderCityWorklist(cityId, fromIndex, toIndex)
        }
        onAssignCitizen={(cityId, x, y) => gameClient.assignCityCitizen(cityId, x, y)}
        onWorkerToSpecialist={(cityId, x, y, specialistType) =>
          gameClient.convertCityWorkerToSpecialist(cityId, x, y, specialistType)
        }
        onSpecialistToTile={(cityId, specialistType, x, y) =>
          gameClient.convertCitySpecialistToTile(cityId, specialistType, x, y)
        }
        onChangeSpecialist={(cityId, fromType, toType) =>
          gameClient.changeCitySpecialist(cityId, fromType, toType)
        }
        onRename={(cityId, name) => gameClient.renameCity(cityId, name)}
        onSellBuilding={(cityId, buildingId) => gameClient.sellCityBuilding(cityId, buildingId)}
        onDisband={cityId => gameClient.disbandCity(cityId)}
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
        onSetRallyPoint={(cityId, rallyPoint) => gameClient.setCityRallyPoint(cityId, rallyPoint)}
      />
    </div>
  );
};
