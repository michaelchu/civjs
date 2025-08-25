import React, { useState, useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { MapCanvas } from '../Canvas2D/MapCanvas';
import { GameTabs } from './GameTabs';
import { StatusPanel } from './StatusPanel';
// import { ChatBox } from './ChatBox'; // Commented out while ChatBox is disabled
import { TurnDoneButton } from './TurnDoneButton';

export const GameLayout: React.FC = () => {
  const [dimensions, setDimensions] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const { activeTab, clientState } = useGameStore();


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
    const headerHeight = 60; // Tab header height
    const statusHeight = 40; // Status bar height
    const padding = 20;

    return {
      width: Math.max(800, dimensions.width - padding),
      height: Math.max(
        600,
        dimensions.height - headerHeight - statusHeight - padding
      ),
    };
  };

  const canvasSize = calculateCanvasSize();

  if (clientState === 'initial' || clientState === 'connecting') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">
        <div className="text-center">
          <div className="text-2xl mb-4">
            {clientState === 'initial'
              ? 'Initializing...'
              : 'Connecting to server...'}
          </div>
          <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gray-800 text-white overflow-hidden">
      {/* Header with tabs and status */}
      <div className="flex items-center justify-between bg-gray-700 px-4 py-2 border-b border-gray-600">
        <GameTabs />
        <div className="flex items-center space-x-4">
          <StatusPanel />
          <TurnDoneButton />
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Primary content */}
        <div className="flex-1 relative">
          {activeTab === 'map' && (
            <div className="h-full relative">
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
          )}

          {activeTab === 'government' && (
            <div className="p-6">
              <h2 className="text-2xl font-bold mb-4">Government</h2>
              <p className="text-gray-300">
                Government options will be implemented here
              </p>
            </div>
          )}

          {activeTab === 'research' && (
            <div className="p-6">
              <h2 className="text-2xl font-bold mb-4">Research</h2>
              <p className="text-gray-300">
                Technology tree will be implemented here
              </p>
            </div>
          )}

          {activeTab === 'nations' && (
            <div className="p-6">
              <h2 className="text-2xl font-bold mb-4">Nations</h2>
              <p className="text-gray-300">
                Diplomacy and nation info will be implemented here
              </p>
            </div>
          )}

          {activeTab === 'cities' && (
            <div className="p-6">
              <h2 className="text-2xl font-bold mb-4">Cities</h2>
              <p className="text-gray-300">
                City management will be implemented here
              </p>
            </div>
          )}

          {activeTab === 'options' && (
            <div className="p-6">
              <h2 className="text-2xl font-bold mb-4">Options</h2>
              <p className="text-gray-300">
                Game options will be implemented here
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
