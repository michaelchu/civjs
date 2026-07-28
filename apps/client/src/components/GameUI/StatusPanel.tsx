import React from 'react';
import { useGameStore } from '../../store/gameStore';

const formatNationName = (nation: string): string => {
  if (nation === 'random') {
    return 'Random';
  }
  // Capitalize first letter of each word
  return nation
    .split(/[\s_-]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

const ResourceDelta: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <span
    aria-label={`${label} per turn`}
    className={value > 0 ? 'text-emerald-400' : value < 0 ? 'text-red-400' : 'text-gray-500'}
  >
    ({value >= 0 ? '+' : ''}
    {value})
  </span>
);

export const StatusPanel: React.FC = () => {
  const turn = useGameStore(state => state.turn);
  const currentPlayer = useGameStore(state => state.players[state.currentPlayerId]);

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
          <ResourceDelta label="Gold" value={currentPlayer.goldPerTurn ?? 0} />
        </div>

        <div className="flex items-center space-x-1">
          <span className="text-gray-400">Science:</span>
          <span className="font-bold text-blue-400">{currentPlayer.science}</span>
          <ResourceDelta label="Science" value={currentPlayer.sciencePerTurn ?? 0} />
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
