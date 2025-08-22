import React from 'react';
import { useGameStore } from '../../store/gameStore';

export const TurnDoneButton: React.FC = () => {
  const { getCurrentPlayer, phase, clientState } = useGameStore();
  const currentPlayer = getCurrentPlayer();

  const handleTurnDone = () => {
    // TODO: Implement turn done functionality
    console.log('Turn done clicked');
    // gameClient.endTurn();
  };

  const isDisabled = 
    clientState !== 'running' || 
    !currentPlayer || 
    !currentPlayer.isActive ||
    phase !== 'movement';

  const getButtonText = () => {
    if (clientState !== 'running') return 'Waiting...';
    if (!currentPlayer?.isActive) return 'Not Your Turn';
    if (phase !== 'movement') return `${phase} Phase`;
    return 'Turn Done';
  };

  const getButtonStyle = () => {
    if (isDisabled) {
      return 'bg-gray-600 text-gray-400 cursor-not-allowed';
    }
    return 'bg-green-600 hover:bg-green-700 text-white cursor-pointer';
  };

  return (
    <button
      onClick={handleTurnDone}
      disabled={isDisabled}
      className={`
        px-6 py-2 rounded font-medium transition-colors duration-200
        focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-800
        ${getButtonStyle()}
      `}
      title={isDisabled ? 'You cannot end your turn right now' : 'End your turn (Shift+Enter)'}
    >
      {getButtonText()}
    </button>
  );
};