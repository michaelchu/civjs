import React, { useEffect, useState } from 'react';
import { useParams, useLocation, Navigate } from 'react-router-dom';
import { useGameStore } from '../store/gameStore';
import { gameClient } from '../services/GameClient';
import { ConnectionDialog } from './ConnectionDialog';
import { GameLayout } from './GameUI/GameLayout';

export const GameRoute: React.FC = () => {
  const { gameId } = useParams<{ gameId: string }>();
  const location = useLocation();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [showNamePrompt, setShowNamePrompt] = useState(true);
  
  const { clientState, setClientState, updateGameState } = useGameStore();

  const handleJoinGame = async (name: string) => {
    if (!gameId || !name.trim()) {
      setError('Please enter a valid player name');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      await gameClient.connect();
      await gameClient.joinSpecificGame(gameId, name.trim());
      
      setShowNamePrompt(false);
      setClientState('connecting');
      
      // Listen for game state updates
      setTimeout(() => {
        setClientState('running');
        setIsLoading(false);
      }, 1000);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join game');
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!gameId) {
      setError('Invalid game ID');
      setIsLoading(false);
      return;
    }

    // Check for player name in URL query parameter
    const urlParams = new URLSearchParams(location.search);
    const urlPlayerName = urlParams.get('playerName');
    if (urlPlayerName) {
      setPlayerName(urlPlayerName);
      handleJoinGame(urlPlayerName);
    } else {
      setIsLoading(false);
    }

    // Store the current game ID
    updateGameState({ currentGameId: gameId });
  }, [gameId, location.search]);

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleJoinGame(playerName);
  };

  // Redirect if no game ID
  if (!gameId) {
    return <Navigate to="/" replace />;
  }

  // Show game if already connected and running
  if (clientState === 'running' && !showNamePrompt) {
    return <GameLayout />;
  }

  // Show connection status if connecting
  if (clientState === 'connecting' && !showNamePrompt) {
    return <ConnectionDialog />;
  }

  // Show player name prompt
  if (showNamePrompt) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-900 to-blue-800 flex items-center justify-center">
        <div className="bg-gray-800 p-8 rounded-lg shadow-2xl w-96 border border-gray-700">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-white mb-2">Join Game</h1>
            <p className="text-gray-300 text-sm">Game ID: {gameId.slice(0, 8)}...</p>
          </div>

          <form onSubmit={handleNameSubmit} className="space-y-4">
            <div>
              <label htmlFor="playerName" className="block text-sm font-medium text-gray-300 mb-2">
                Enter Your Name
              </label>
              <input
                id="playerName"
                type="text"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="Your player name"
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={isLoading}
                maxLength={32}
                autoFocus
              />
            </div>

            {error && (
              <div className="p-3 bg-red-900 border border-red-700 rounded-md text-red-200 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || !playerName.trim()}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:text-gray-400 text-white font-medium rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800"
            >
              {isLoading ? (
                <div className="flex items-center justify-center">
                  <div className="animate-spin w-5 h-5 border-2 border-blue-300 border-t-transparent rounded-full mr-2"></div>
                  Joining Game...
                </div>
              ) : (
                'Join Game'
              )}
            </button>
          </form>

          <div className="mt-4 text-center">
            <a
              href="/"
              className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              ← Back to Home
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-900 to-blue-800 flex items-center justify-center">
      <div className="text-center text-white">
        <div className="animate-spin w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full mx-auto mb-4"></div>
        <p>Loading game...</p>
      </div>
    </div>
  );
};