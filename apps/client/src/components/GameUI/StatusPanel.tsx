import React from 'react';
import { useGameStore } from '../../store/gameStore';

const formatNationName = (nation: string): string => {
  console.log('StatusPanel: formatNationName called with:', nation);
  if (nation === 'random') {
    return 'Random';
  }
  // Capitalize first letter of each word
  return nation
    .split(/[\s_-]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

export const StatusPanel: React.FC = () => {
  const { turn, getCurrentPlayer } = useGameStore();
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

      {/* Player info */}
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-1">
          <span className="text-gray-400">Gold:</span>
          <span className="font-bold text-primary">{currentPlayer.gold}</span>
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
        <span className="font-medium text-white">{formatNationName(currentPlayer.nation)}</span>
      </div>
    </div>
  );
};
