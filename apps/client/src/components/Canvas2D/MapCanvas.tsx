/**
 * @module client/components/Canvas2D/MapCanvas
 * Defines the Map Canvas canvas component.
 */
import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { MapRenderer } from './MapRenderer';
import { ActionFeedbackBanner, type ActionFeedback } from './ActionFeedbackBanner';
import { UnitContextMenu } from '../GameUI/UnitContextMenu';
import { CityNameDialog } from '../GameUI/CityNameDialog';
import { CityInfoOverlay } from '../GameUI/CityInfoOverlay';
import { TileInfoOverlay } from '../GameUI/TileInfoOverlay';
import type { Unit, City, MapViewport } from '../../types';
import { ActionType } from '../../types/shared/actions';
import { gameClient } from '../../services/GameClient';
import { useNation } from '../../hooks/useNations';
import { pathfindingService, type GotoPath } from '../../services/PathfindingService';
import {
  determineMapClickAction,
  findCityAtTile,
  findSelectableCityUnit,
  getUnitsAtTile,
  type ClickOptions,
} from '../../utils/mapInteraction';
import {
  loadUserPreferences,
  USER_PREFERENCES_CHANGED_EVENT,
  type UserPreferences,
} from '../../services/UserPreferences';
import { findInitialMapCenter } from '../../utils/initialMapCenter';
import { getNextNationCityName } from '../../utils/cityNames';
import { shallow } from 'zustand/shallow';
import { useCityOverlayController } from './useCityOverlayController';

interface MapCanvasProps {
  width: number;
  height: number;
  rulesetName?: string;
}

type SelectionDragMode = 'left' | 'right' | null;
interface SelectionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const getSelectionRect = (
  start: { x: number; y: number },
  end: { x: number; y: number }
): SelectionRect => ({
  left: Math.min(start.x, end.x),
  top: Math.min(start.y, end.y),
  width: Math.abs(end.x - start.x),
  height: Math.abs(end.y - start.y),
});

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
  const [reducedMotion, setReducedMotion] = useState(() => loadUserPreferences().reducedMotion);

  // Track initial centering to prevent multiple centering events (freeciv-web compliance)
  const [hasInitiallyCentered, setHasInitiallyCentered] = useState(false);

  // Unit selection and context menu state
  const [selectedUnit, setSelectedUnit] = useState<Unit | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    unit: Unit;
    position: { x: number; y: number };
    city?: City;
  } | null>(null);
  const [tileInfoPosition, setTileInfoPosition] = useState<{ x: number; y: number } | null>(null);
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
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
  const [targetActionOptions, setTargetActionOptions] = useState<{
    unit: Unit;
    action: ActionType;
    targetX: number;
    targetY: number;
    options: Array<{ id: string; label: string }>;
  } | null>(null);

  const viewport = useGameStore(state => state.viewport);
  const map = useGameStore(state => state.map);
  const units = useGameStore(state => state.units);
  const cities = useGameStore(state => state.cities);
  const players = useGameStore(state => state.players);
  const currentPlayerId = useGameStore(state => state.currentPlayerId);
  const currentGameId = useGameStore(state => state.currentGameId);
  const diplomacy = useGameStore(state => state.diplomacy);
  const focusedUnits = useGameStore(state => state.focusedUnits);
  const selectedUnitId = useGameStore(state => state.selectedUnitId);
  const mapData = useGameStore(state => state.mapData);
  const hasReceivedUnitSnapshot = useGameStore(state => state.hasReceivedUnitSnapshot);
  const setViewport = useGameStore(state => state.setViewport);
  const selectUnit = useGameStore(state => state.selectUnit);
  const selectUnits = useGameStore(state => state.selectUnits);
  const toggleUnits = useGameStore(state => state.toggleUnits);
  const selectCity = useGameStore(state => state.selectCity);
  const cityOverlay = useCityOverlayController(cities, selectCity);
  const currentPlayer = players[currentPlayerId];
  const { nation: currentNation } = useNation(currentPlayer?.nation ?? '', rulesetName);
  const suggestedCityName = useMemo(() => {
    return getNextNationCityName(
      currentNation?.cities,
      Object.values(cities).map(city => city.name)
    );
  }, [cities, currentNation]);

  const clearMapSelection = useCallback(() => {
    selectUnit(null);
    selectCity(null);
    setSelectedUnit(null);
  }, [selectCity, selectUnit]);

  const openCityInfo = useCallback(
    (city: City) => {
      setContextMenu(null);
      setSelectedUnit(null);
      selectUnit(null);
      cityOverlay.open(city);
    },
    [cityOverlay, selectUnit]
  );

  const openTileInfo = useCallback((x: number, y: number) => {
    setContextMenu(null);
    setTileInfoPosition({ x, y });
  }, []);

  const selectUnitsAndMirror = useCallback(
    (unitIds: string[]) => {
      selectUnits(unitIds);
      const state = useGameStore.getState();
      setSelectedUnit(state.focusedUnits[0] ? (state.units[state.focusedUnits[0]] ?? null) : null);
    },
    [selectUnits]
  );

  const toggleUnitsAndMirror = useCallback(
    (unitIds: string[]) => {
      toggleUnits(unitIds);
      const state = useGameStore.getState();
      setSelectedUnit(state.focusedUnits[0] ? (state.units[state.focusedUnits[0]] ?? null) : null);
    },
    [toggleUnits]
  );

  const openUnitContextMenu = useCallback(
    (unit: Unit, position: { x: number; y: number }, city?: City) => {
      if (unit.playerId !== currentPlayerId) return;
      setContextMenu({ unit, position, city });
      selectUnit(unit.id);
      setSelectedUnit(unit);
    },
    [currentPlayerId, selectUnit]
  );

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

  // Handle keyboard-triggered actions
  useEffect(() => {
    const handleActivateGoto = (event: CustomEvent) => {
      const { unit } = event.detail;
      if (unit && unit.playerId === currentPlayerId && focusedUnits.includes(unit.id)) {
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
      if (!unit || unit.playerId !== currentPlayerId || !canvasRef.current) return;
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
      if (!unit || unit.playerId !== currentPlayerId || !action) return;
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
  }, [currentPlayerId, focusedUnits, selectUnit, setGotoMode]);

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
            presentationEffects: gameState.presentationEffects,
            cities: gameState.cities,
            players: gameState.players,
            selectedUnitId: gameState.selectedUnitId,
            focusedUnits: gameState.focusedUnits,
            currentPlayerId: gameState.currentPlayerId,
            researchedTechs: gameState.research?.researchedTechs,
            reducedMotion: loadUserPreferences().reducedMotion,
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
      setReducedMotion(preferences.reducedMotion);
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
          presentationEffects: state.presentationEffects,
          cities: state.cities,
          players: state.players,
          selectedUnitId: state.selectedUnitId,
          selectedCityId: state.selectedCityId,
          actionDecisionUnitId: contextMenu?.unit.id,
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
          reducedMotion,
        },
        immediate
      );
    },
    [contextMenu?.unit.id, gotoMode.currentPath, movementRange, reducedMotion]
  );

  const cameraSlideFrame = useRef<number | null>(null);
  const cameraSlideViewport = useRef<MapViewport | null>(null);

  const cancelCameraSlide = useCallback(
    (commitLatest = true): MapViewport | null => {
      if (cameraSlideFrame.current !== null) {
        cancelAnimationFrame(cameraSlideFrame.current);
        cameraSlideFrame.current = null;
      }
      const latestViewport = cameraSlideViewport.current;
      cameraSlideViewport.current = null;
      if (commitLatest && latestViewport) setViewport(latestViewport);
      return latestViewport;
    },
    [setViewport]
  );

  useEffect(() => {
    const handleCenterMap = (event: Event) => {
      const detail = (event as CustomEvent<{ x?: number; y?: number }>).detail;
      if (detail.x === undefined || detail.y === undefined || !rendererRef.current) return;

      cancelCameraSlide();
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
      const target = { ...constrained, width, height };
      const state = useGameStore.getState();
      const current = state.viewport;
      const dx = target.x - current.x;
      const dy = target.y - current.y;

      if (!Object.values(state.units).some(unit => unit.x === detail.x && unit.y === detail.y)) {
        const marker = {
          id: `marker:${detail.x}:${detail.y}:${Date.now()}`,
          type: 'marker' as const,
          x: detail.x,
          y: detail.y,
          startedAt: performance.now(),
          durationMs: 900,
        };
        state.updateGameState({
          presentationEffects: [...(state.presentationEffects ?? []), marker].slice(-64),
        });
      }

      if (reducedMotion || Math.hypot(dx, dy) < 1) {
        cameraSlideViewport.current = null;
        setViewport(target);
        renderLatestSnapshot(target, true);
        return;
      }

      const startedAt = performance.now();
      const durationMs = 700;
      const animate = (now: number) => {
        const progress = Math.min(1, (now - startedAt) / durationMs);
        const eased = 1 - Math.pow(1 - progress, 3);
        const viewportOverride = {
          ...current,
          width,
          height,
          x: current.x + dx * eased,
          y: current.y + dy * eased,
        };
        cameraSlideViewport.current = viewportOverride;
        renderLatestSnapshot(viewportOverride, true);

        if (progress >= 1) {
          cameraSlideFrame.current = null;
          cameraSlideViewport.current = null;
          setViewport(target);
          return;
        }
        cameraSlideFrame.current = requestAnimationFrame(animate);
      };

      cameraSlideFrame.current = requestAnimationFrame(animate);
    };

    document.addEventListener('center-map-on-tile', handleCenterMap);
    return () => {
      document.removeEventListener('center-map-on-tile', handleCenterMap);
      cancelCameraSlide(false);
    };
  }, [cancelCameraSlide, height, reducedMotion, renderLatestSnapshot, setViewport, width]);

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
          state.presentationEffects,
          state.cities,
          state.players,
          state.selectedUnitId,
          state.selectedCityId,
          contextMenu?.unit.id,
          state.focusedUnits,
          state.urgentFocusQueue,
          state.currentPlayerId,
          state.research?.researchedTechs,
        ] as const,
      () => renderLatestSnapshot(),
      { equalityFn: shallow }
    );
  }, [contextMenu?.unit.id, renderLatestSnapshot, rendererReady]);

  const hasRenderableSelection = Boolean(
    (selectedUnitId && units[selectedUnitId]) || focusedUnits.some(unitId => units[unitId])
  );

  // Optimized animation for selection pulsing - use a simple timer instead of continuous animation loop
  useEffect(() => {
    // Don't run animation while dragging to prevent conflicts
    if (hasRenderableSelection && rendererRef.current && !isDragging) {
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
  }, [hasRenderableSelection, isDragging, renderLatestSnapshot]);

  // Drag tracking refs
  const dragStart = useRef({ x: 0, y: 0 });
  const dragStartViewport = useRef(viewport);
  const currentRenderViewport = useRef(viewport);
  const dragRenderFrame = useRef<number | null>(null);
  const dragStartTime = useRef<number>(0);
  const selectionDragMode = useRef<SelectionDragMode>(null);
  const rightDragHandled = useRef(false);
  const lastTouchTap = useRef<{ x: number; y: number; time: number } | null>(null);
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
        const pathResult = await pathfindingService.requestPathResult(
          gotoMode.unit.id,
          targetX,
          targetY
        );
        const path = pathResult.path;

        if (path) {
          setGotoMode(prev => ({
            ...prev,
            targetTile: { x: targetX, y: targetY },
            currentPath: path,
          }));
          console.log('Path received:', path);
        } else {
          const message = pathResult.error ?? 'No valid path found';
          console.warn(message);
          setActionFeedback({ success: false, message });
          setGotoMode(prev => ({
            ...prev,
            targetTile: { x: targetX, y: targetY },
            currentPath: null,
          }));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to request a Go To path';
        console.error('Error requesting path:', error);
        setActionFeedback({ success: false, message });
        setGotoMode(prev => ({
          ...prev,
          targetTile: { x: targetX, y: targetY },
          currentPath: null,
        }));
      }
    },
    [gotoMode.unit]
  );

  // Execute goto action when target is selected
  const executeGoto = useCallback(
    async (targetX: number, targetY: number) => {
      if (!gotoMode.unit) return;

      const targetCity = Object.values(cities).find(
        city => city.x === targetX && city.y === targetY
      );
      const targetRelation = targetCity
        ? diplomacy?.nations.find(nation => nation.id === targetCity.playerId)?.relation.state
        : undefined;
      const willDeclareWar = Boolean(
        targetCity &&
        targetCity.playerId !== currentPlayerId &&
        targetRelation !== 'war' &&
        targetRelation !== 'alliance' &&
        targetRelation !== 'team'
      );

      if (willDeclareWar) {
        const confirmed = window.confirm(
          `Entering ${targetCity!.name} will declare war on its owner. Continue?`
        );
        if (!confirmed) return;
      }

      console.log(`Executing goto for unit ${gotoMode.unit.id} to (${targetX}, ${targetY})`);

      try {
        const result = await gameClient.executeUnitAction(
          gotoMode.unit.id,
          ActionType.GOTO,
          targetX,
          targetY,
          willDeclareWar
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
    [cities, currentPlayerId, diplomacy, gotoMode.unit, deactivateGotoMode, selectUnit]
  );

  const executeTargetAction = useCallback(
    async (targetX: number, targetY: number) => {
      if (!targetActionMode) return;
      const selectableAction =
        targetActionMode.action === ActionType.STEAL_TECH ||
        targetActionMode.action === ActionType.SABOTAGE_CITY;
      if (selectableAction) {
        try {
          const options = await gameClient.getUnitActionOptions(
            targetActionMode.unit.id,
            targetActionMode.action,
            targetX,
            targetY
          );
          if (options.length === 0) throw new Error('No selectable targets are available');
          setTargetActionOptions({
            unit: targetActionMode.unit,
            action: targetActionMode.action,
            targetX,
            targetY,
            options,
          });
          setTargetActionMode(null);
          setActionFeedback({ success: true, message: 'Choose a target for the mission' });
        } catch (error) {
          setActionFeedback({
            success: false,
            message: error instanceof Error ? error.message : 'Could not load mission targets',
          });
          setTargetActionMode(null);
        }
        return;
      }
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

  const executeSelectedTargetOption = useCallback(
    async (optionId: string) => {
      if (!targetActionOptions) return;
      try {
        const result = await gameClient.executeUnitAction(
          targetActionOptions.unit.id,
          targetActionOptions.action,
          targetActionOptions.targetX,
          targetActionOptions.targetY,
          false,
          targetActionOptions.action === ActionType.STEAL_TECH ? optionId : undefined,
          targetActionOptions.action === ActionType.SABOTAGE_CITY ? optionId : undefined
        );
        setActionFeedback({
          success: true,
          message: result.message || `${targetActionOptions.action.replaceAll('_', ' ')} completed`,
        });
      } catch (error) {
        setActionFeedback({
          success: false,
          message: error instanceof Error ? error.message : 'Targeted action failed',
        });
      } finally {
        setTargetActionOptions(null);
        selectUnit(null);
        setSelectedUnit(null);
      }
    },
    [selectUnit, targetActionOptions]
  );

  const selectUnitsInCanvasRect = useCallback(
    (start: { x: number; y: number }, end: { x: number; y: number }) => {
      const renderer = rendererRef.current;
      if (!renderer) return;

      const left = Math.min(start.x, end.x);
      const right = Math.max(start.x, end.x);
      const top = Math.min(start.y, end.y);
      const bottom = Math.max(start.y, end.y);
      const xSamples = new Set<number>([left, right]);
      const ySamples = new Set<number>([top, bottom]);

      for (let x = left; x <= right; x += 12) xSamples.add(x);
      for (let y = top; y <= bottom; y += 12) ySamples.add(y);

      const selectedIds = new Set<string>();
      const activeViewport = useGameStore.getState().viewport;
      for (const canvasX of xSamples) {
        for (const canvasY of ySamples) {
          const mapPos = renderer.canvasToMap(canvasX, canvasY, activeViewport);
          const tileX = Math.floor(mapPos.mapX);
          const tileY = Math.floor(mapPos.mapY);
          getUnitsAtTile(units, tileX, tileY)
            .filter(unit => unit.playerId === currentPlayerId)
            .forEach(unit => selectedIds.add(unit.id));
        }
      }

      if (selectedIds.size > 0) {
        selectUnitsAndMirror([...selectedIds]);
      } else {
        clearMapSelection();
      }
    },
    [clearMapSelection, currentPlayerId, selectUnitsAndMirror, units]
  );

  const handleMapTileClick = useCallback(
    (
      tileX: number,
      tileY: number,
      options: ClickOptions,
      position?: { x: number; y: number },
      showContextMenuOnCityUnit = false
    ) => {
      const unitsAtTile = getUnitsAtTile(units, tileX, tileY);
      const cityAtTile = findCityAtTile(cities, tileX, tileY);

      // City clicks have priority over the visual unit stack. A movable
      // friendly unit exposes a context menu (which includes Show City),
      // while a blocked/foreign stack falls through to the city dialog.
      if (!options.shiftKey && cityAtTile) {
        const cityUnit = findSelectableCityUnit(unitsAtTile, cityAtTile, currentPlayerId);
        if (cityUnit) {
          if (showContextMenuOnCityUnit && position) {
            openUnitContextMenu(cityUnit, position, cityAtTile);
          } else {
            selectUnit(cityUnit.id);
            setSelectedUnit(cityUnit);
          }
          return;
        }

        if (!options.isGotoMode) {
          openCityInfo(cityAtTile);
          return;
        }
      }

      const clickResult = determineMapClickAction(
        tileX,
        tileY,
        unitsAtTile,
        currentPlayerId,
        focusedUnits,
        options
      );

      switch (clickResult.action) {
        case 'select':
          if (clickResult.unitIds.length > 0) {
            const unit = units[clickResult.unitIds[0]];
            if (unit) {
              selectUnit(unit.id);
              setSelectedUnit(unit);
            }
          } else {
            // Foreign units remain inspectable, but their action tray is
            // read-only because SelectionTray gates actions by ownership.
            const foreignUnit = unitsAtTile.find(unit => unit.playerId !== currentPlayerId);
            if (foreignUnit) {
              selectUnit(foreignUnit.id);
              setSelectedUnit(foreignUnit);
            } else {
              clearMapSelection();
            }
          }
          break;
        case 'focus':
          toggleUnitsAndMirror(clickResult.unitIds);
          break;
        case 'none':
          break;
      }
    },
    [
      cities,
      clearMapSelection,
      currentPlayerId,
      focusedUnits,
      openCityInfo,
      openUnitContextMenu,
      selectUnit,
      toggleUnitsAndMirror,
      units,
    ]
  );

  const handleRightClickTile = useCallback(
    (tileX: number, tileY: number, position: { x: number; y: number }) => {
      const unitsAtTile = getUnitsAtTile(units, tileX, tileY);
      const cityAtTile = findCityAtTile(cities, tileX, tileY);
      const ownUnit = unitsAtTile.find(unit => unit.playerId === currentPlayerId);

      if (ownUnit) {
        openUnitContextMenu(ownUnit, position, cityAtTile);
        return;
      }

      // Reference behavior: right-clicking an empty or foreign tile recenters
      // the map rather than opening an actionable foreign-unit menu.
      setContextMenu(null);
      document.dispatchEvent(
        new CustomEvent('center-map-on-tile', { detail: { x: tileX, y: tileY } })
      );
    },
    [cities, currentPlayerId, openUnitContextMenu, units]
  );

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      // Middle-click is the reference client's direct tile-info shortcut.
      if (event.button === 1) {
        const rect = canvas.getBoundingClientRect();
        const canvasX = event.clientX - rect.left;
        const canvasY = event.clientY - rect.top;
        const mapPos = rendererRef.current?.canvasToMap(canvasX, canvasY, viewport);
        if (mapPos) openTileInfo(Math.floor(mapPos.mapX), Math.floor(mapPos.mapY));
        event.preventDefault();
        return;
      }

      if (event.button !== 0 && event.button !== 2) return;

      const slideViewport = cancelCameraSlide();
      const interactionViewport = slideViewport ?? viewport;

      const rect = canvas.getBoundingClientRect();
      const canvasX = event.clientX - rect.left;
      const canvasY = event.clientY - rect.top;

      // Close context menu if open
      setContextMenu(null);
      rightDragHandled.current = false;

      selectionDragMode.current =
        event.button === 2 || (event.altKey && !event.shiftKey && !event.ctrlKey)
          ? event.button === 2
            ? 'right'
            : 'left'
          : null;
      setSelectionRect(null);

      // Record drag start for potential drag operation
      dragStart.current = { x: canvasX, y: canvasY };
      dragStartViewport.current = interactionViewport;
      currentRenderViewport.current = interactionViewport;
      dragStartTime.current = Date.now();

      // Don't immediately set dragging - wait for actual movement
    },
    [cancelCameraSlide, openTileInfo, viewport]
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || !rendererRef.current) return;

      const rect = canvas.getBoundingClientRect();
      const canvasX = event.clientX - rect.left;
      const canvasY = event.clientY - rect.top;

      const dragDistance = Math.hypot(canvasX - dragStart.current.x, canvasY - dragStart.current.y);
      const isAreaSelection = selectionDragMode.current !== null;

      // Check if we should start dragging or selecting a rectangle.
      if (!isDragging && dragStartTime.current > 0 && dragDistance > DRAG_THRESHOLD) {
        setIsDragging(true);
        canvas.style.cursor = isAreaSelection ? 'crosshair' : 'move';
      }

      if (isAreaSelection && dragStartTime.current > 0 && dragDistance > DRAG_THRESHOLD) {
        setSelectionRect(getSelectionRect(dragStart.current, { x: canvasX, y: canvasY }));
        return;
      }
      if (isAreaSelection) return;

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

      const areaMode = selectionDragMode.current;
      const areaWasDragged =
        areaMode !== null &&
        (isDragging ||
          Math.hypot(canvasX - dragStart.current.x, canvasY - dragStart.current.y) >
            DRAG_THRESHOLD);

      if (areaMode) {
        if (areaWasDragged) {
          selectUnitsInCanvasRect(dragStart.current, { x: canvasX, y: canvasY });
          rightDragHandled.current = areaMode === 'right';
        }
        selectionDragMode.current = null;
        setSelectionRect(null);
        setIsDragging(false);
        canvas.style.cursor = 'crosshair';
        dragStartTime.current = 0;
        event.preventDefault();
        return;
      }

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

        handleMapTileClick(
          tileX,
          tileY,
          clickOptions,
          { x: event.clientX, y: event.clientY },
          true
        );
      }

      // Reset drag tracking
      dragStartTime.current = 0;
    },
    [
      isDragging,
      setViewport,
      handleMapTileClick,
      selectUnitsInCanvasRect,
      viewport,
      gotoMode.active,
      executeGoto,
      targetActionMode,
      executeTargetAction,
    ]
  );

  // Touch event handlers for mobile panning + actions
  const handleTouchStart = useCallback(
    (event: React.TouchEvent<HTMLCanvasElement>) => {
      if (event.touches.length !== 1) return; // Only handle single touch

      const canvas = canvasRef.current;
      if (!canvas) return;
      const slideViewport = cancelCameraSlide();
      const interactionViewport = slideViewport ?? viewport;

      const touch = event.touches[0];
      const rect = canvas.getBoundingClientRect();
      const canvasX = touch.clientX - rect.left;
      const canvasY = touch.clientY - rect.top;

      // Close any open context menu
      setContextMenu(null);
      selectionDragMode.current = null;
      setSelectionRect(null);

      // Prepare drag like mouse: don't set dragging until we move beyond threshold
      setIsDragging(false);
      dragStart.current = { x: canvasX, y: canvasY };
      dragStartViewport.current = interactionViewport;
      currentRenderViewport.current = interactionViewport;
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
            // Emulate the reference right-click behavior on long press.
            const mapPos = rendererRef.current.canvasToMap(canvasX, canvasY, interactionViewport);
            const tileX = Math.floor(mapPos.mapX);
            const tileY = Math.floor(mapPos.mapY);
            handleRightClickTile(tileX, tileY, { x: touch.clientX, y: touch.clientY });
          }
        }
      }, LONG_PRESS_MS);

      // Prevent default to avoid page scrolling
      event.preventDefault();
    },
    [cancelCameraSlide, viewport, gotoMode.active, deactivateGotoMode, handleRightClickTile]
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
          const now = Date.now();
          const previousTap = lastTouchTap.current;
          const isDoubleTap = Boolean(
            previousTap &&
            now - previousTap.time < 350 &&
            previousTap.x === tileX &&
            previousTap.y === tileY
          );

          if (isDoubleTap) {
            openTileInfo(tileX, tileY);
            lastTouchTap.current = null;
          } else {
            lastTouchTap.current = { x: tileX, y: tileY, time: now };
            handleMapTileClick(
              tileX,
              tileY,
              {
                shiftKey: false,
                ctrlKey: false,
                altKey: false,
                button: 0,
                isGotoMode: false,
              },
              { x: tapClientX, y: tapClientY },
              true
            );
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
      handleMapTileClick,
      openTileInfo,
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

      if (rightDragHandled.current) {
        rightDragHandled.current = false;
        return;
      }

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

      handleRightClickTile(tileX, tileY, { x: event.clientX, y: event.clientY });
    },
    [viewport, gotoMode.active, deactivateGotoMode, targetActionMode, handleRightClickTile]
  );

  // Handle unit action selection
  const handleActionSelect = useCallback(
    async (action: ActionType, targetX?: number, targetY?: number) => {
      if (!selectedUnit || selectedUnit.playerId !== currentPlayerId) return;

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
    [currentPlayerId, selectedUnit]
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
      if (event.key === 'Escape' && (gotoMode.active || targetActionMode || targetActionOptions)) {
        if (gotoMode.active) deactivateGotoMode();
        setTargetActionMode(null);
        setTargetActionOptions(null);
        event.preventDefault();
        event.stopPropagation();
      }
    };

    if (gotoMode.active || targetActionMode || targetActionOptions) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [gotoMode.active, targetActionMode, targetActionOptions, deactivateGotoMode]);

  // Global mouse up handler to catch mouse up events outside the canvas
  useEffect(() => {
    const handleGlobalMouseUp = (event: MouseEvent) => {
      if (selectionDragMode.current && canvasRef.current) {
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const canvasX = event.clientX - rect.left;
        const canvasY = event.clientY - rect.top;
        const areaMode = selectionDragMode.current;
        const wasDragged =
          isDragging ||
          Math.hypot(canvasX - dragStart.current.x, canvasY - dragStart.current.y) > DRAG_THRESHOLD;

        if (wasDragged) {
          selectUnitsInCanvasRect(dragStart.current, { x: canvasX, y: canvasY });
          rightDragHandled.current = areaMode === 'right';
        }
        selectionDragMode.current = null;
        setSelectionRect(null);
        setIsDragging(false);
        canvas.style.cursor = 'crosshair';
        dragStartTime.current = 0;
        return;
      }

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
  }, [isDragging, selectUnitsInCanvasRect, setViewport]);

  // Removed zoom functionality to match freeciv-web 2D canvas behavior
  // Freeciv-web's 2D renderer does not support zoom - only the WebGL renderer does

  const contextCity = contextMenu
    ? (contextMenu.city ?? findCityAtTile(cities, contextMenu.unit.x, contextMenu.unit.y))
    : undefined;
  const contextTileUnits = contextMenu
    ? getUnitsAtTile(units, contextMenu.unit.x, contextMenu.unit.y)
    : [];
  const contextTile = contextMenu
    ? map.tiles[`${contextMenu.unit.x},${contextMenu.unit.y}`]
    : undefined;
  const contextOwnedUnits = contextTileUnits.filter(unit => unit.playerId === currentPlayerId);
  const tileInfoTile = tileInfoPosition
    ? (map.tiles[`${tileInfoPosition.x},${tileInfoPosition.y}`] ?? null)
    : null;
  const tileInfoUnits = tileInfoPosition
    ? getUnitsAtTile(units, tileInfoPosition.x, tileInfoPosition.y)
    : [];
  const tileInfoCity = tileInfoPosition
    ? findCityAtTile(cities, tileInfoPosition.x, tileInfoPosition.y)
    : undefined;

  return (
    <div className="relative overflow-hidden bg-blue-900 w-full h-full">
      <ActionFeedbackBanner feedback={actionFeedback} onDismiss={dismissActionFeedback} />
      {targetActionMode && (
        <div className="absolute right-3 top-3 z-[1100] rounded bg-amber-700 px-3 py-2 text-sm text-white shadow">
          Select a target · Esc to cancel
        </div>
      )}
      {targetActionOptions && (
        <div className="absolute right-3 top-3 z-[1101] w-72 rounded bg-slate-900 p-3 text-sm text-white shadow-xl">
          <div className="mb-2 font-semibold">
            {targetActionOptions.action === ActionType.STEAL_TECH
              ? 'Choose technology to steal'
              : 'Choose improvement to sabotage'}
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {targetActionOptions.options.map(option => (
              <button
                key={option.id}
                type="button"
                className="block w-full rounded bg-slate-700 px-2 py-1 text-left hover:bg-slate-600"
                onClick={() => void executeSelectedTargetOption(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="mt-2 w-full rounded bg-slate-800 px-2 py-1 text-slate-300 hover:bg-slate-700"
            onClick={() => setTargetActionOptions(null)}
          >
            Cancel
          </button>
        </div>
      )}
      {selectionRect && (
        <div
          aria-label="Unit selection area"
          className="pointer-events-none absolute z-20 border border-cyan-200/90 bg-cyan-300/15"
          style={selectionRect}
        />
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
          city={contextCity}
          tile={contextTile}
          onClose={handleCloseContextMenu}
          onActionSelect={handleActionSelect}
          onShowCity={contextCity ? () => openCityInfo(contextCity) : undefined}
          onShowTileInfo={() => openTileInfo(contextMenu.unit.x, contextMenu.unit.y)}
          onSelectAllOnTile={
            contextOwnedUnits.length > 1
              ? () => selectUnitsAndMirror(contextOwnedUnits.map(unit => unit.id))
              : undefined
          }
          onSelectSameType={
            contextOwnedUnits.filter(unit => unit.unitTypeId === contextMenu.unit.unitTypeId)
              .length > 1
              ? () =>
                  selectUnitsAndMirror(
                    contextOwnedUnits
                      .filter(unit => unit.unitTypeId === contextMenu.unit.unitTypeId)
                      .map(unit => unit.id)
                  )
              : undefined
          }
        />
      )}

      <CityNameDialog
        isOpen={cityNameDialog.isOpen}
        unit={cityNameDialog.unit}
        suggestedName={suggestedCityName}
        onClose={handleCloseCityNameDialog}
        onFoundCity={handleFoundCity}
      />

      <CityInfoOverlay
        city={cityOverlay.overlay.city}
        isOpen={cityOverlay.overlay.isOpen}
        onClose={cityOverlay.close}
        units={units}
        availableProductions={cityOverlay.production.availableProductions}
        isLoadingProductions={cityOverlay.production.isLoading}
        productionError={cityOverlay.production.error}
        onRetryProductions={cityOverlay.retry}
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

      {tileInfoPosition && (
        <TileInfoOverlay
          tile={tileInfoTile}
          x={tileInfoPosition.x}
          y={tileInfoPosition.y}
          units={tileInfoUnits}
          city={tileInfoCity}
          isOpen={true}
          onClose={() => setTileInfoPosition(null)}
        />
      )}
    </div>
  );
};
