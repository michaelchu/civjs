// Reference: /root/repo/reference/freeciv-web/javascript/overview.js:52-138
import React, { useState, useCallback } from 'react';
import { MinimapCanvas } from '../Canvas2D/MinimapCanvas';
import type { MinimapColorMode } from '../../utils/minimapRenderer';
import { useGameStore } from '../../store/gameStore';

interface MinimapPanelProps {
  onCenterMap?: (x: number, y: number) => void;
}

export const MinimapPanel: React.FC<MinimapPanelProps> = ({ onCenterMap }) => {
  const [isMinimized, setIsMinimized] = useState(false);
  const [colorMode, setColorMode] = useState<MinimapColorMode>(1); // Default to primary nation colors

  const { map, minimapVisible, setMinimapVisible } = useGameStore();

  // Calculate minimap dimensions
  const calculateMinimapSize = useCallback(() => {
    if (!map) return { width: 200, height: 140 };

    const minWidth = 200;
    const maxWidth = 300;
    const maxHeight = 300;

    let tileSize = 1;
    const mapWidth = map.xsize || map.width;
    const mapHeight = map.ysize || map.height;

    while (minWidth > tileSize * mapWidth && tileSize < 4) {
      tileSize++;
    }

    let width = tileSize * mapWidth;
    if (width > maxWidth) width = maxWidth;

    let height = tileSize * mapHeight;
    if (height > maxHeight) height = maxHeight;

    return { width, height };
  }, [map]);

  const { width: minimapWidth, height: minimapHeight } = calculateMinimapSize();

  /**
   * Handle color mode cycling (like freeciv-web)
   * Reference: freeciv-web/javascript/control.js:3860-3862
   */
  const handleColorModeToggle = useCallback(() => {
    setColorMode(prev => ((prev + 1) % 4) as MinimapColorMode);
  }, []);

  /**
   * Handle centering the main map when minimap is clicked
   */
  const handleMinimapClick = useCallback(
    (x: number, y: number) => {
      if (onCenterMap) {
        onCenterMap(x, y);
      }
    },
    [onCenterMap]
  );

  const handleMinimize = useCallback(() => {
    setIsMinimized(!isMinimized);
  }, [isMinimized]);

  const handleClose = useCallback(() => {
    setMinimapVisible(false);
  }, [setMinimapVisible]);

  if (!minimapVisible || !map) {
    return null;
  }

  const colorModeNames = ['Relations', 'Primary', 'Secondary', 'Tertiary'];

  return (
    <div
      className={`absolute bottom-4 left-4 bg-gray-900 bg-opacity-90 border border-gray-600 rounded shadow-lg ${
        isMinimized ? 'w-16 h-8' : ''
      }`}
      style={{
        width: isMinimized ? '65px' : `${minimapWidth + 20}px`,
        height: isMinimized ? '32px' : `${minimapHeight + 40}px`,
      }}
    >
      {/* Title bar */}
      <div className="flex items-center justify-between bg-gray-800 px-2 py-1 rounded-t border-b border-gray-600">
        <div className="flex items-center space-x-1">
          <img
            src="/images/e/earth.png"
            alt="Globe"
            className="w-4 h-4"
            onError={e => {
              // Fallback to text if image not found
              const target = e.target as HTMLImageElement;
              target.style.display = 'none';
              target.nextElementSibling!.textContent = '🌍';
            }}
          />
          <span className="text-xs text-gray-300">🌍</span>
          {!isMinimized && <span className="text-xs text-gray-300 ml-1">Minimap</span>}
        </div>

        <div className="flex items-center space-x-1">
          {/* Minimize/Restore button */}
          <button
            onClick={handleMinimize}
            className="text-gray-400 hover:text-white text-xs w-4 h-4 flex items-center justify-center"
            title={isMinimized ? 'Restore' : 'Minimize'}
          >
            {isMinimized ? '□' : '−'}
          </button>

          {/* Color mode toggle (only when not minimized) */}
          {!isMinimized && (
            <button
              onClick={handleColorModeToggle}
              className="text-gray-400 hover:text-white text-xs px-1"
              title={`Color Mode: ${colorModeNames[colorMode]} (Click to cycle)`}
            >
              C
            </button>
          )}

          {/* Close button */}
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-red-400 text-xs w-4 h-4 flex items-center justify-center"
            title="Close Minimap"
          >
            ×
          </button>
        </div>
      </div>

      {/* Minimap content */}
      {!isMinimized && (
        <div className="p-2">
          <MinimapCanvas
            width={minimapWidth}
            height={minimapHeight}
            colorMode={colorMode}
            onTileClick={handleMinimapClick}
            className="border border-gray-700 rounded"
          />

          {/* Status bar */}
          <div className="mt-1 text-xs text-gray-400 text-center">
            Mode: {colorModeNames[colorMode]}
            {colorMode === 0 && <span className="ml-2 text-gray-500">(Diplomatic Relations)</span>}
          </div>
        </div>
      )}
    </div>
  );
};
