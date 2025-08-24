import React, { useRef, useEffect, useCallback } from 'react';
import { useGameStore } from '../../store/gameStore';
import {
  init_mapview,
  init_sprites,
  mapview_put_tile,
  is_sprites_loaded,
  onLoadingStateChange,
  setCanvasContext,
} from '../../rendering/mapview';
import { fill_sprite_array } from '../../rendering/tilespec';
import {
  LAYER_TERRAIN1,
  LAYER_TERRAIN2,
  LAYER_TERRAIN3,
  LAYER_ROADS,
  LAYER_SPECIAL1,
  LAYER_SPECIAL2,
  LAYER_FOG,
  LAYER_UNIT,
  LAYER_CITY1,
} from '../../rendering/constants';
import { mapview, update_map_canvas, center_tile_mapcanvas_2d } from '../../rendering/mapview-common';

interface MapCanvasProps {
  width: number;
  height: number;
}

interface LoadingState {
  progress: number;
  message: string;
}

export const MapCanvas: React.FC<MapCanvasProps> = ({ width, height }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { clientState, units } = useGameStore();
  const [loadingState, setLoadingState] = React.useState<LoadingState>({
    progress: 0,
    message: 'Initializing...',
  });

  // Initialize canvas and sprites
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Set the canvas context for the rendering system
    setCanvasContext(canvas);

    // Set up loading state listener
    const unsubscribe = onLoadingStateChange(setLoadingState);

    // Initialize mapview system
    init_mapview();

    // Initialize sprites
    init_sprites().catch(error => {
      console.error('Failed to initialize sprites:', error);
      setLoadingState({ progress: 0, message: 'Failed to load sprites' });
    });

    // No need to create test data - server provides real data

    return () => {
      unsubscribe();
    };
  }, []);

  // Get game state with proper React subscription
  const tilesArray = useGameStore(state => state.tilesArray);
  const mapInfo = useGameStore(state => state.mapInfo);

  // Render map tiles
  const renderMap = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !is_sprites_loaded()) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // If we have no tiles data, show a placeholder
    if (!tilesArray || !mapInfo) {
      ctx.fillStyle = '#2d5016'; // Dark green background
      ctx.fillRect(0, 0, width, height);

      // No grid pattern - tiles should be rendered as isometric diamonds

      // Show placeholder text
      ctx.fillStyle = '#ffffff';
      ctx.font = '24px Arial';
      ctx.textAlign = 'center';
      if (clientState === 'running') {
        ctx.fillText('Map Loading...', width / 2, height / 2);
        ctx.fillText('(Waiting for tile data)', width / 2, height / 2 + 30);
      } else {
        ctx.fillText('Connecting to server...', width / 2, height / 2);
        ctx.fillText(`State: ${clientState}`, width / 2, height / 2 + 30);
      }
      return;
    }

    // Initialize mapview state for isometric rendering
    mapview['width'] = width;
    mapview['height'] = height;
    
    // Initialize viewport origin if not set - center the map using freeciv-web approach
    // Reference: client_main.js line 68 calls center_on_any_city() and control.js line 3356-3363
    if (mapview['gui_x0'] === undefined || mapview['gui_y0'] === undefined) {
      let centerTile = null;
      
      // First try to center on player's first unit (like advance_unit_focus in reference)
      // Reference: control.js center_on_any_city logic but for units
      const unitIds = Object.keys(units);
      if (unitIds.length > 0) {
        const firstUnit = units[unitIds[0]];
        if (firstUnit && firstUnit.x !== undefined && firstUnit.y !== undefined) {
          centerTile = {
            x: firstUnit.x,
            y: firstUnit.y
          };
          console.log(`🎯 Centering map on player's first unit at tile(${firstUnit.x},${firstUnit.y})`);
        }
      }
      
      // Fallback: try to find a visible tile instead of just map center
      if (!centerTile) {
        // Look for first visible tile (where known > 0)
        let visibleTile = null;
        if (tilesArray) {
          for (let i = 0; i < Math.min(100, tilesArray.length); i++) {
            const tile = tilesArray[i];
            if (tile && tile.known > 0) {
              visibleTile = { x: tile.x, y: tile.y };
              console.log(`🎯 Found visible tile at (${tile.x},${tile.y}) with known=${tile.known}`);
              break;
            }
          }
        }
        
        if (visibleTile) {
          centerTile = visibleTile;
        } else {
          // Final fallback to map center
          const centerTileX = Math.floor(mapInfo.xsize / 2);
          const centerTileY = Math.floor(mapInfo.ysize / 2);
          centerTile = {
            x: centerTileX,
            y: centerTileY
          };
          console.log(`🎯 No units or visible tiles found, centering map on tile(${centerTileX},${centerTileY})`);
        }
      }
      
      // Reference: mapview_common.js line 49-59 center_tile_mapcanvas_2d implementation
      center_tile_mapcanvas_2d(centerTile);
    }

    // Use the proper isometric rendering function from freeciv-web
    try {
      update_map_canvas(0, 0, width, height, ctx, mapInfo, tilesArray);
    } catch (error) {
      console.error('Error in isometric rendering:', error);
      
      // Fallback: show that we have tile data but isometric rendering needs work
      ctx.fillStyle = '#2d5016'; // Dark green background
      ctx.fillRect(0, 0, width, height);
      
      ctx.fillStyle = '#ffffff';
      ctx.font = '18px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Isometric Rendering Active', width / 2, height / 2 - 20);
      ctx.fillText(`Map: ${mapInfo.xsize}x${mapInfo.ysize} (${tilesArray.length} tiles)`, width / 2, height / 2);
      ctx.fillText('Check console for detailed rendering logs', width / 2, height / 2 + 20);
    }
  }, [width, height, clientState, tilesArray, mapInfo]);

  // Re-render when sprites are loaded or game state changes
  useEffect(() => {
    if (is_sprites_loaded()) {
      renderMap();
    }
  }, [renderMap, loadingState]);

  // Simple terrain color mapping for fallback
  const getTerrainColor = (terrainName: string): string => {
    const colors: { [key: string]: string } = {
      grassland: '#7CB342',
      plains: '#8BC34A',
      desert: '#FFB300',
      forest: '#388E3C',
      hills: '#8D6E63',
      mountains: '#5D4037',
      ocean: '#1976D2',
      coast: '#2196F3',
      lake: '#03A9F4',
      swamp: '#689F38',
      jungle: '#2E7D32',
      tundra: '#78909C',
      arctic: '#ECEFF1',
    };
    return colors[terrainName] || '#4CAF50';
  };

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="border border-gray-600 bg-gray-800"
        style={{
          imageRendering: 'pixelated',
          cursor: 'crosshair',
        }}
      />

      {/* Loading overlay */}
      {loadingState.progress < 100 && (
        <div className="absolute inset-0 bg-black bg-opacity-75 flex items-center justify-center">
          <div className="text-center text-white">
            <div className="text-xl mb-2">{loadingState.message}</div>
            <div className="w-64 bg-gray-700 rounded-full h-4">
              <div
                className="bg-blue-500 h-4 rounded-full transition-all duration-300"
                style={{ width: `${loadingState.progress}%` }}
              />
            </div>
            <div className="text-sm mt-2">
              {Math.round(loadingState.progress)}%
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
