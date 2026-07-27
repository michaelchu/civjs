import React, { useState, useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { MapCanvas } from '../Canvas2D/MapCanvas';
import { GameTabs } from './GameTabs';
import { StatusPanel } from './StatusPanel';
// import { ChatBox } from './ChatBox'; // Commented out while ChatBox is disabled
import { TurnDoneButton } from './TurnDoneButton';
import { TechnologyTree } from '../Research/TechnologyTree';
import { GovernmentPanel } from './GovernmentPanel';
import { CitiesPanel } from './CitiesPanel';
import { GameOptionsPanel } from './GameOptionsPanel';
import { NotificationFeed } from './NotificationFeed';
import { NationsPanel } from './NationsPanel';
import { useKeyboardControls } from '../../hooks/useKeyboardControls';
import { EndGamePanel } from './EndGamePanel';

export const GameLayout: React.FC = () => {
  const [dimensions, setDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const { activeTab, clientState } = useGameStore();

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
      <NotificationFeed />
      <EndGamePanel />
      {/* Header with tabs and status */}
      <div className="flex items-center justify-between bg-gray-700 px-4 py-1 border-b border-gray-600">
        <GameTabs />
        <div className="flex items-center space-x-4">
          <StatusPanel />
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

            {/* Overlay UI elements - COMMENTED OUT */}
            {/* <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end pointer-events-none">
              {/* Chat box */}
            {/* <div className="w-80 pointer-events-auto">
                <ChatBox />
              </div> */}

            {/* Overview mini-map would go here */}
            {/* <div className="w-48 h-32 bg-gray-900 bg-opacity-80 border border-gray-600 rounded pointer-events-auto">
                <div className="p-2 text-sm text-gray-300">
                  Mini-map placeholder
                </div>
              </div> */}
            {/* </div> */}
          </div>

          <div className={`${activeTab === 'government' ? 'block' : 'hidden'}`}>
            <GovernmentPanel />
          </div>

          <div
            className={`h-full w-full relative ${activeTab === 'research' ? 'block' : 'hidden'}`}
          >
            <TechnologyTree />
          </div>

          <div className={`h-full ${activeTab === 'nations' ? 'block' : 'hidden'}`}>
            <NationsPanel />
          </div>

          <div className={`h-full ${activeTab === 'cities' ? 'block' : 'hidden'}`}>
            <CitiesPanel />
          </div>

          <div className={`h-full ${activeTab === 'options' ? 'block' : 'hidden'}`}>
            <GameOptionsPanel />
          </div>
        </div>
      </div>
    </div>
  );
};
