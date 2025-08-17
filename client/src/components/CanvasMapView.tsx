/**
 * CanvasMapView - React component for pure Canvas2D map rendering
 * Uses advanced isometric rendering techniques
 */

import {
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
  useCallback,
} from 'react';
import { IsometricRenderer } from './IsometricRenderer';
import { buildTerrainMapFromServerData } from '../types/terrain';
import { ClientMapGenerator } from '../services/ClientMapGenerator';
import type { MapSeed } from '../services/ClientMapGenerator';

interface GameState {
  mapWidth?: number;
  mapHeight?: number;
  map?: Array<{ x: number; y: number; terrain: string }>;
  units?: Array<{ id: string; x: number; y: number; type: string }>;
  cities?: Array<{ id: string; x: number; y: number; name: string }>;
  // New seed-based properties
  seed?: string;
  mapSize?: 'small' | 'medium' | 'large';
}

interface CanvasMapViewProps {
  gameId: string;
  gameState: GameState | null;
  onTileClick?: (x: number, y: number) => void;
  onUnitSelect?: (unitId: string) => void;
  onEndTurn?: () => void;
}

export interface CanvasMapViewHandle {
  updateGameState: (state: GameState) => void;
  centerCamera: (x: number, y: number) => void;
  highlightTile: (x: number, y: number) => void;
}

const CanvasMapView = forwardRef<CanvasMapViewHandle, CanvasMapViewProps>(
  ({ gameState, onTileClick, onUnitSelect }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rendererRef = useRef<IsometricRenderer | null>(null);
    const unitsRef = useRef<
      Array<{ id: string; x: number; y: number; type: string }>
    >([]);
    const citiesRef = useRef<
      Array<{ id: string; x: number; y: number; name: string }>
    >([]);
    const mapGeneratorRef = useRef<ClientMapGenerator>(
      new ClientMapGenerator()
    );

    /**
     * Initialize canvas and renderer
     */
    const initializeCanvas = useCallback(() => {
      if (!canvasRef.current || !containerRef.current) return;

      const canvas = canvasRef.current;
      const container = containerRef.current;

      // Set canvas size to fill container
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;

      // Create renderer with complete mouse handling
      const renderer = new IsometricRenderer(canvas, {
        onTileClick: (x, y) => {
          // Check if click is on a unit or city first
          const unit = unitsRef.current.find(u => u.x === x && u.y === y);
          if (unit && onUnitSelect) {
            onUnitSelect(unit.id);
            return;
          }

          // Otherwise handle as tile click
          if (onTileClick) {
            onTileClick(x, y);
          }
        },
        onRightClick: (x, y) => {
          // Right click already handled by renderer for recentering
          console.log(`Right click on tile: ${x}, ${y}`);
        },
      });
      rendererRef.current = renderer;

      // Start render loop
      renderer.startRenderLoop();

      console.log('Canvas2D renderer initialized');
    }, [onTileClick, onUnitSelect]);

    /**
     * Handle window resize
     */
    const handleResize = useCallback(() => {
      if (!containerRef.current || !canvasRef.current || !rendererRef.current)
        return;

      const container = containerRef.current;
      const canvas = canvasRef.current;

      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;

      rendererRef.current.resize(container.clientWidth, container.clientHeight);
    }, []);

    /**
     * Update game state
     */
    const updateGameState = useCallback((state: GameState) => {
      if (!rendererRef.current) return;

      const mapWidth = state.mapWidth || 40;
      const mapHeight = state.mapHeight || 40;

      // Check if we have seed-based generation (new system)
      if (state.seed && state.mapSize) {
        console.log(`🌍 Generating map client-side from seed: ${state.seed}`);

        const mapSeed: MapSeed = {
          gameId: state.seed.split('-')[0] || 'unknown',
          seed: state.seed,
          mapSize: state.mapSize,
          generatedAt: new Date().toISOString(),
        };

        // Generate terrain map from seed
        const terrainMap = mapGeneratorRef.current.generateFromSeed(mapSeed);

        // Update renderer with generated terrain
        const dimensions = mapGeneratorRef.current.getMapDimensions(
          state.mapSize
        );
        rendererRef.current.setTerrainMap(
          terrainMap,
          dimensions.width,
          dimensions.height
        );

        console.log(
          `✅ Generated ${dimensions.width}x${dimensions.height} map from seed`
        );
      } else if (state.map && state.map.length > 0) {
        // Fallback to legacy server-provided tiles
        console.log(`📊 Using legacy map tiles: ${state.map.length} tiles`);

        // Build terrain map from server data
        const terrainMap = buildTerrainMapFromServerData(
          state.map,
          mapWidth,
          mapHeight
        );

        // Update renderer with server terrain
        rendererRef.current.setTerrainMap(terrainMap, mapWidth, mapHeight);
      } else {
        // No map data yet
        console.log('⏳ Waiting for map data from server...');
        return;
      }

      // Store units and cities for click detection
      unitsRef.current = state.units || [];
      citiesRef.current = state.cities || [];

      // Update renderer with units and cities
      if (state.units) {
        rendererRef.current.setUnits(state.units);
      }
      if (state.cities) {
        rendererRef.current.setCities(state.cities);
      }
    }, []);

    /**
     * Center camera on specific tile
     */
    const centerCamera = useCallback((x: number, y: number) => {
      if (rendererRef.current) {
        rendererRef.current.centerOnTile(x, y);
      }
    }, []);

    /**
     * Highlight a specific tile
     */
    const highlightTile = useCallback((x: number, y: number) => {
      // TODO: Implement tile highlighting
      console.log(`Highlighting tile: ${x}, ${y}`);
    }, []);

    // Expose methods to parent component
    useImperativeHandle(
      ref,
      () => ({
        updateGameState,
        centerCamera,
        highlightTile,
      }),
      [updateGameState, centerCamera, highlightTile]
    );

    // Initialize canvas on mount
    useEffect(() => {
      initializeCanvas();

      // Add resize listener
      window.addEventListener('resize', handleResize);

      // Cleanup
      return () => {
        window.removeEventListener('resize', handleResize);

        if (rendererRef.current) {
          rendererRef.current.destroy();
          rendererRef.current = null;
        }
      };
    }, [initializeCanvas, handleResize]);

    // Update game state when it changes
    useEffect(() => {
      if (gameState) {
        updateGameState(gameState);
      }
    }, [gameState, updateGameState]);

    return (
      <div
        ref={containerRef}
        className="w-full h-full relative bg-black"
        style={{ minHeight: '600px' }}
      >
        <canvas
          ref={canvasRef}
          className="absolute top-0 left-0 w-full h-full"
          style={{
            cursor: 'grab',
            imageRendering: 'pixelated', // For crisp pixels
          }}
        />

        {/* UI Overlay - can add game controls here */}
        <div className="absolute top-4 right-4 bg-black/50 text-white p-2 rounded">
          <div className="text-sm">Canvas2D Renderer</div>
          <div className="text-xs opacity-75">
            Drag to pan • Scroll to zoom • Click to select
          </div>
        </div>
      </div>
    );
  }
);

CanvasMapView.displayName = 'CanvasMapView';

export default CanvasMapView;
