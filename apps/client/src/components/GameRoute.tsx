import React, { useEffect, useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { useGameStore } from '../store/gameStore';
import { gameClient } from '../services/GameClient';
import { ConnectionDialog } from './ConnectionDialog';
import { GameLayout } from './GameUI/GameLayout';

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

      // Generate a default player name or use stored one
      const defaultPlayerName = `Player_${Date.now().toString(36)}`;

      // First try to join as a player
      try {
        await gameClient.joinSpecificGame(gameId, defaultPlayerName);
      } catch (joinError) {
        console.log(
          'Could not join as player, trying observer mode:',
          joinError
        );

        // If joining as player fails, try to observe the game
        try {
          await gameClient.observeGame(gameId);
          console.log('Joined as observer');
        } catch {
          throw new Error(
            `Cannot access game: ${joinError instanceof Error ? joinError.message : 'Unknown error'}`
          );
        }
      }

      // Set to running state after successful join/observe
      // Map data will be received via socket events (map-info, tile-info)
      setClientState('running');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load game');
      setClientState('initial');
    }
  };

  useEffect(() => {
    if (!gameId) {
      setError('Invalid game ID');
      setIsLoading(false);
      return;
    }

    // Check if we're already connected to this game
    if (gameClient.isConnected() && gameClient.getCurrentGameId() === gameId) {
      setClientState('running');
    } else {
      // Auto-load the game
      loadGame();
    }

    // Store the current game ID
    useGameStore.setState({ currentGameId: gameId });
  }, [gameId]);

  // Redirect if no game ID
  if (!gameId) {
    return <Navigate to="/" replace />;
  }

  // Show game if connected and running
  if (clientState === 'running') {
    return <GameLayout />;
  }

  // Show connection status if connecting
  if (clientState === 'connecting') {
    return <ConnectionDialog showForm={false} />;
  }

  // Show loading or error state
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
              <a
                href="/"
                className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
              >
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
