import React from 'react';
import { useGameStore } from '../../store/gameStore';

export const StatusPanel: React.FC = () => {
  const { turn, getCurrentPlayer, phase } = useGameStore();
  const currentPlayer = getCurrentPlayer();

  if (!currentPlayer) {
    return (
      <div className="flex items-center space-x-4 text-sm text-gray-400">
        <span>Loading...</span>
      </div>
    );
  }

  return (
    <div className="flex items-center space-x-6 text-sm">
      {/* Turn counter */}
      <div className="flex items-center space-x-1">
        <span className="text-gray-400">Turn:</span>
        <span className="font-bold text-white">{turn}</span>
      </div>

      {/* Phase indicator */}
      <div className="flex items-center space-x-1">
        <span className="text-gray-400">Phase:</span>
        <span className="font-medium text-blue-400 capitalize">{phase}</span>
      </div>

      {/* Player info */}
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-1">
          <span className="text-gray-400">Gold:</span>
          <span className="font-bold text-yellow-400">{currentPlayer.gold}</span>
        </div>

        <div className="flex items-center space-x-1">
          <span className="text-gray-400">Science:</span>
          <span className="font-bold text-blue-400">{currentPlayer.science}</span>
        </div>
      </div>

      {/* Player nation */}
      <div className="flex items-center space-x-2">
        <div
          className="w-4 h-4 rounded border border-gray-500"
          style={{ backgroundColor: currentPlayer.color }}
        />
        <span className="font-medium text-white">{currentPlayer.nation}</span>
      </div>
    </div>
  );
};
