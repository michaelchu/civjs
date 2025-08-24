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
  const { clientState } = useGameStore();
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

  // Render map tiles
  const renderMap = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !is_sprites_loaded()) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Get current game state
    const { tilesArray, mapInfo } = useGameStore.getState();

    // If we have no tiles data, show a placeholder
    if (!tilesArray || !mapInfo) {
      ctx.fillStyle = '#2d5016'; // Dark green background
      ctx.fillRect(0, 0, width, height);

      // Draw grid pattern for testing
      ctx.strokeStyle = '#3d6026';
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 96) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += 48) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

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

    // Render actual map tiles using freeciv-web data
    const tileWidth = 96;
    const tileHeight = 48;
    const mapWidth = mapInfo.xsize;
    const mapHeight = mapInfo.ysize;

    // Calculate visible area (simple viewport for now)
    const tilesX = Math.min(Math.ceil(width / tileWidth), mapWidth);
    const tilesY = Math.min(Math.ceil(height / tileHeight), mapHeight);

    console.log(
      `Rendering ${tilesX}x${tilesY} tiles from map ${mapWidth}x${mapHeight}, tiles array length: ${tilesArray.length}`
    );

    // Render tiles layer by layer like freeciv-web
    const layers = [
      LAYER_TERRAIN1,
      LAYER_TERRAIN2,
      LAYER_TERRAIN3,
      LAYER_ROADS,
      LAYER_SPECIAL1,
      LAYER_CITY1,
      LAYER_UNIT,
      LAYER_SPECIAL2,
      LAYER_FOG,
    ];

    for (const layer of layers) {
      for (let y = 0; y < tilesY; y++) {
        for (let x = 0; x < tilesX; x++) {
          const tileIndex = y * mapWidth + x;
          const tile = tilesArray[tileIndex];

          if (tile && tile.known > 0) {
            // Only render known tiles
            try {
              // Use the rendering system to get sprites for this tile and layer
              const sprites = fill_sprite_array(layer, tile);

              // Draw each sprite
              sprites.forEach(sprite => {
                if (typeof sprite === 'string') {
                  mapview_put_tile(ctx, sprite, x * tileWidth, y * tileHeight);
                } else if (sprite.tag) {
                  mapview_put_tile(
                    ctx,
                    sprite.tag,
                    x * tileWidth,
                    y * tileHeight
                  );
                }
              });
            } catch {
              // Only show fallback for terrain layers
              if (layer === LAYER_TERRAIN1) {
                ctx.fillStyle = getTerrainColor(tile.terrain || 'grassland');
                ctx.fillRect(
                  x * tileWidth,
                  y * tileHeight,
                  tileWidth,
                  tileHeight
                );
              }
            }
          }
        }
      }
    }
  }, [width, height, clientState]);

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
