/**
 * @module client/components/GameRoute
 * Defines the Game Route client UI component.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { useGameStore } from '../store/gameStore';
import { gameClient } from '../services/GameClient';
import { ConnectionDialog } from './ConnectionDialog';
import { GameLayout } from './GameUI/GameLayout';
import { getStoredUsername, storeUsername } from '../utils/gameSession';
import { PageBackground } from './shared/PageBackground';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';

export const GameRoute: React.FC = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const [error, setError] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [readyGameId, setReadyGameId] = useState<string | null>(null);

  const clientState = useGameStore(state => state.clientState);
  const setClientState = useGameStore(state => state.setClientState);

  const loadGame = useCallback(async () => {
    if (!gameId) {
      setError('Invalid game ID');
      return;
    }

    setError('');
    setIsJoining(true);
    setReadyGameId(null);

    try {
      await gameClient.connect();
      setClientState('connecting');

      // Use stored username or generate fallback name based on gameId
      const storedUsername = getStoredUsername();
      const username = storedUsername || `Player_${gameId?.slice(-8) || 'default'}`;

      // For single player games, join with 'random' nation selection
      // The server will assign the appropriate nation based on game settings
      await gameClient.joinSpecificGame(gameId, username, 'random');

      // Store the username after successful join for future login convenience
      storeUsername(username);

      setClientState(useGameStore.getState().endGameReport ? 'over' : 'running');
      setReadyGameId(gameId);
    } catch (joinError) {
      console.log('Could not join as player:', joinError);

      // Try observer mode as fallback
      console.log('Trying observer mode');
      try {
        await gameClient.observeGame(gameId);
        console.log('Joined as observer');
        setClientState('running');
        setReadyGameId(gameId);
      } catch {
        setError(
          `Cannot access game: ${joinError instanceof Error ? joinError.message : 'Unknown error'}`
        );
        setClientState('initial');
      }
    } finally {
      setIsJoining(false);
    }
  }, [gameId, setClientState]);

  useEffect(() => {
    if (!gameId) {
      setError('Invalid game ID');
      return;
    }

    // A reload is a normal way to resume an active game. loadGame() restores
    // the saved player identity and reconnects it to the existing game.
    if (gameClient.isConnected() && gameClient.getCurrentGameId() === gameId) {
      setClientState(useGameStore.getState().endGameReport ? 'over' : 'running');
      setReadyGameId(gameId);
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
  }, [gameId, loadGame, setClientState]);

  if (!gameId) {
    return <Navigate to="/" replace />;
  }

  if ((clientState === 'running' || clientState === 'over') && readyGameId === gameId) {
    return <GameLayout />;
  }

  // Show connection status if connecting
  if (clientState === 'connecting') {
    return <ConnectionDialog showForm={false} />;
  }

  return (
    <PageBackground className="min-h-screen flex items-center justify-center p-4">
      {error ? (
        <Card className="w-full max-w-md shadow-2xl">
          <CardHeader>
            <CardTitle>Failed to Load Game</CardTitle>
            <CardDescription className="text-destructive">{error}</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3">
            <Button onClick={() => void loadGame()}>Retry</Button>
            <a href="/" className="text-sm text-primary hover:underline">
              ← Back to Home
            </a>
          </CardContent>
        </Card>
      ) : (
        <div className="text-center text-foreground">
          <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
          <p>{isJoining ? 'Joining game...' : 'Loading game...'}</p>
        </div>
      )}
    </PageBackground>
  );
};
