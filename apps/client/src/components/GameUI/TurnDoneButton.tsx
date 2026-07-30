import React from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { gameClient } from '../../services/GameClient';

export const TurnDoneButton: React.FC = () => {
  const currentPlayer = useGameStore(state => state.players[state.currentPlayerId]);
  const phase = useGameStore(state => state.phase);
  const clientState = useGameStore(state => state.clientState);
  const startTurnProcessing = useGameStore(state => state.startTurnProcessing);
  const turnProcessingState = useGameStore(state => state.turnProcessingState);

  const handleTurnDone = () => {
    // Start the turn processing animation
    startTurnProcessing();

    // Send the actual end turn packet
    gameClient.endTurn();
  };

  const isDisabled =
    clientState !== 'running' ||
    !currentPlayer ||
    !currentPlayer.isActive ||
    phase !== 'movement' ||
    turnProcessingState === 'processing';

  const getButtonText = () => {
    if (turnProcessingState === 'processing') return 'Processing...';
    if (clientState !== 'running') return 'Waiting...';
    if (!currentPlayer?.isActive) return 'Not Your Turn';
    if (phase !== 'movement') return `${phase} Phase`;
    return 'Turn Done';
  };

  return (
    <button
      onClick={handleTurnDone}
      disabled={isDisabled}
      className={`flex h-10 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold shadow-lg transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-300/70 disabled:cursor-not-allowed ${
        isDisabled
          ? 'border-white/10 bg-white/5 text-slate-500'
          : 'border-emerald-300/35 bg-emerald-400/20 text-emerald-100 hover:bg-emerald-400/30'
      }`}
      title={isDisabled ? 'You cannot end your turn right now' : 'End your turn (Shift+Enter)'}
    >
      {turnProcessingState === 'processing' ? (
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <Check className="h-4 w-4" aria-hidden="true" />
      )}
      {getButtonText()}
    </button>
  );
};
