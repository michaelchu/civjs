import React, { useEffect, useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { useGameStore } from '../store/gameStore';
import { gameClient } from '../services/GameClient';
import { ConnectionDialog } from './ConnectionDialog';
import { GameLayout } from './GameUI/GameLayout';
import {
  getStoredPlayerName,
  isCurrentGameSinglePlayer,
  storePlayerNameForGame,
} from '../utils/gameSession';

export const GameRoute: React.FC = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const [error, setError] = useState('');

  const { clientState, setClientState } = useGameStore();

  const loadGame = async () => {
    if (!gameId) {
      setError('Invalid game ID');
      return;
    }

    setError('');

    try {
      await gameClient.connect();
      setClientState('connecting');

      // Try to get stored player name first, fallback to default
      const storedPlayerName = getStoredPlayerName(gameId);
      const isSinglePlayer = isCurrentGameSinglePlayer(gameId);
      // Use consistent fallback name based on gameId so refreshes use the same username
      const fallbackName = storedPlayerName || `Player_${gameId?.slice(-8) || 'default'}`;
      const playerName = fallbackName;

      try {
        await gameClient.joinSpecificGame(gameId, playerName);

        // Store the player name after successful join so it persists across refreshes
        storePlayerNameForGame(gameId!, playerName, isSinglePlayer ? 'single' : 'multiplayer');
      } catch (joinError) {
        console.log('Could not join as player:', joinError);

        // For single player games, never fall back to observer mode
        if (isSinglePlayer) {
          throw new Error(
            `Failed to rejoin single player game: ${
              joinError instanceof Error ? joinError.message : 'Unknown error'
            }`
          );
        }

        // For multiplayer games, try observer mode as fallback
        console.log('Trying observer mode for multiplayer game');
        try {
          await gameClient.observeGame(gameId);
          console.log('Joined as observer');
        } catch {
          throw new Error(
            `Cannot access game: ${
              joinError instanceof Error ? joinError.message : 'Unknown error'
            }`
          );
        }
      }

      setClientState('running');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load game');
      setClientState('initial');
    }
  };

  useEffect(() => {
    if (!gameId) {
      setError('Invalid game ID');
      return;
    }

    if (gameClient.isConnected() && gameClient.getCurrentGameId() === gameId) {
      setClientState('running');
    } else {
      loadGame();
    }

    useGameStore.setState({ currentGameId: gameId });
  }, [gameId]);

  if (!gameId) {
    return <Navigate to="/" replace />;
  }

  if (clientState === 'running') {
    return <GameLayout />;
  }

  // Show connection status if connecting
  if (clientState === 'connecting') {
    return <ConnectionDialog showForm={false} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-900 to-blue-800 flex items-center justify-center">
      <div className="text-center text-white">
        {error ? (
          <div className="bg-red-900 border border-red-700 rounded-lg p-6 max-w-md mx-auto">
            <h2 className="text-xl font-bold mb-2">Failed to Load Game</h2>
            <p className="text-red-200 mb-4">{error}</p>
            <button
              onClick={loadGame}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
            >
              Retry
            </button>
            <div className="mt-4">
              <a href="/" className="text-sm text-blue-400 hover:text-blue-300 transition-colors">
                ← Back to Home
              </a>
            </div>
          </div>
        ) : (
          <div>
            <div className="animate-spin w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p>Loading game...</p>
          </div>
        )}
      </div>
    </div>
  );
};
