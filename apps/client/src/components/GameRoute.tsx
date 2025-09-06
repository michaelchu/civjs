import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Navigate, useNavigate } from 'react-router-dom';
import { useGameStore } from '../store/gameStore';
import { gameClient } from '../services/GameClient';
import { ConnectionDialog } from './ConnectionDialog';
import { GameLayout } from './GameUI/GameLayout';
import { NationSelectionDialog } from './NationSelectionDialog';
import { getStoredUsername, storeUsername } from '../utils/gameSession';

export const GameRoute: React.FC = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const [error, setError] = useState('');
  const [showNationDialog, setShowNationDialog] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const navigate = useNavigate();

  const { clientState, setClientState } = useGameStore();

  const loadGame = useCallback(async () => {
    if (!gameId) {
      setError('Invalid game ID');
      return;
    }

    setError('');

    try {
      await gameClient.connect();
      setClientState('connecting');

      // Use stored username or generate fallback name based on gameId
      const storedUsername = getStoredUsername();
      const username = storedUsername || `Player_${gameId?.slice(-8) || 'default'}`;
      setPlayerName(username);

      // Show nation selection dialog instead of immediately joining
      setShowNationDialog(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to server');
      setClientState('initial');
    }
  }, [gameId, setClientState]);

  const handleNationSelection = async (selectedNation: string) => {
    if (!gameId || !playerName) return;

    setIsJoining(true);
    setError('');

    try {
      await gameClient.joinSpecificGame(gameId, playerName, selectedNation);

      // Store the username after successful join for future login convenience
      storeUsername(playerName);

      setShowNationDialog(false);
      setClientState('running');
    } catch (joinError) {
      console.log('Could not join as player:', joinError);

      // Try observer mode as fallback
      console.log('Trying observer mode');
      try {
        await gameClient.observeGame(gameId);
        console.log('Joined as observer');
        setShowNationDialog(false);
        setClientState('running');
      } catch {
        setError(
          `Cannot access game: ${joinError instanceof Error ? joinError.message : 'Unknown error'}`
        );
      }
    } finally {
      setIsJoining(false);
    }
  };

  const handleNationDialogClose = () => {
    setShowNationDialog(false);
    navigate('/browse-games');
  };

  useEffect(() => {
    if (!gameId) {
      setError('Invalid game ID');
      return;
    }

    // Check if this page load was due to a reload/refresh using modern API
    const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    const wasPageReloaded = navEntries.length > 0 && navEntries[0].type === 'reload';

    // Only redirect to lobby on actual page refresh, not on navigation
    if (wasPageReloaded && !gameClient.isConnected()) {
      // This was a page reload and we're not connected, redirect to lobby
      navigate('/browse-games');
      return;
    }

    if (gameClient.isConnected() && gameClient.getCurrentGameId() === gameId) {
      setClientState('running');
    } else {
      loadGame();
    }

    useGameStore.setState({ currentGameId: gameId });

    // Add beforeunload event listener for confirmation
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      // Show confirmation dialog
      const message =
        'Are you sure you want to leave the game? You will be redirected to the game lobby.';
      event.preventDefault();
      event.returnValue = message;
      return message;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    // Cleanup event listeners on component unmount
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [gameId, navigate, loadGame, setClientState]);

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
    <>
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

      <NationSelectionDialog
        isOpen={showNationDialog}
        onClose={handleNationDialogClose}
        onConfirm={handleNationSelection}
        playerName={playerName}
        loading={isJoining}
      />
    </>
  );
};
