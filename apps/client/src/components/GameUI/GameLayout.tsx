import React, { useState, useEffect, useCallback } from 'react';
import { useGameStore } from '../../store/gameStore';
import { MapCanvas } from '../Canvas2D/MapCanvas';
import { GameTabs } from './GameTabs';
import { StatusPanel } from './StatusPanel';
// import { ChatBox } from './ChatBox'; // Commented out while ChatBox is disabled
import { TurnDoneButton } from './TurnDoneButton';
import { TechnologyTree } from '../Research/TechnologyTree';
import { GovernmentPanel } from './GovernmentPanel';
import { MinimapPanel } from './MinimapPanel';
import { useKeyboardControls } from '../../hooks/useKeyboardControls';

export const GameLayout: React.FC = () => {
  const [dimensions, setDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const { activeTab, clientState, setViewport, minimapVisible, setMinimapVisible } = useGameStore();

  // Initialize keyboard controls
  useKeyboardControls();

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const calculateCanvasSize = () => {
    const headerHeight = 52; // Combined tab header and status bar height (reduced)
    const padding = 0; // Remove padding to use full space

    return {
      width: Math.max(800, dimensions.width - padding),
      height: Math.max(600, dimensions.height - headerHeight - padding),
    };
  };

  const canvasSize = calculateCanvasSize();

  // Handle minimap click to center main map
  const handleMinimapCenterMap = useCallback(
    (x: number, y: number) => {
      setViewport({ x, y });
    },
    [setViewport]
  );

  if (clientState === 'initial' || clientState === 'connecting') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">
        <div className="text-center">
          <div className="text-2xl mb-4">
            {clientState === 'initial' ? 'Initializing...' : 'Connecting to server...'}
          </div>
          <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-800 text-white overflow-hidden flex flex-col">
      {/* Header with tabs and status */}
      <div className="flex items-center justify-between bg-gray-700 px-4 py-1 border-b border-gray-600">
        <GameTabs />
        <div className="flex items-center space-x-4">
          <StatusPanel />
          <button
            onClick={() => setMinimapVisible(!minimapVisible)}
            className="px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded text-xs"
            title={minimapVisible ? 'Hide Minimap' : 'Show Minimap'}
          >
            🗺️ {minimapVisible ? 'Hide' : 'Show'} Map
          </button>
          <TurnDoneButton />
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Primary content */}
        <div className="flex-1 relative">
          {/* Keep MapCanvas mounted but hidden to avoid reloading tileset */}
          <div className={`h-full relative ${activeTab === 'map' ? 'block' : 'hidden'}`}>
            <MapCanvas width={canvasSize.width} height={canvasSize.height} />

            {/* Overlay UI elements */}
            <div className="absolute inset-0 pointer-events-none">
              {/* Minimap in bottom-left corner */}
              <div className="pointer-events-auto">
                <MinimapPanel onCenterMap={handleMinimapCenterMap} />
              </div>
            </div>
          </div>

          <div className={`${activeTab === 'government' ? 'block' : 'hidden'}`}>
            <GovernmentPanel />
          </div>

          <div
            className={`h-full w-full relative ${activeTab === 'research' ? 'block' : 'hidden'}`}
          >
            <TechnologyTree />
          </div>

          <div
            className={`${activeTab === 'nations' ? 'block' : 'hidden'}`}
            style={{ padding: '24px', backgroundColor: '#4a5568', height: '100%' }}
          >
            <h2
              style={{
                color: 'white',
                fontSize: '24px',
                fontWeight: 'bold',
                marginBottom: '16px',
              }}
            >
              Nations
            </h2>
            <p style={{ color: '#cbd5e0' }}>Diplomacy and nation info will be implemented here</p>
          </div>

          <div className={`p-6 ${activeTab === 'cities' ? 'block' : 'hidden'}`}>
            <h2 className="text-2xl font-bold mb-4">Cities</h2>
            <p className="text-gray-300">City management will be implemented here</p>
          </div>

          <div className={`p-6 ${activeTab === 'options' ? 'block' : 'hidden'}`}>
            <h2 className="text-2xl font-bold mb-4">Options</h2>
            <p className="text-gray-300">Game options will be implemented here</p>
          </div>
        </div>
      </div>
    </div>
  );
};
