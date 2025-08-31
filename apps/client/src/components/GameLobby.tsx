import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { gameClient } from '../services/GameClient';
import { DataTable } from './ui/DataTable';
import { createGameColumns, type GameInfo } from './GameLobbyColumns';

export const GameLobby: React.FC = () => {
  const [games, setGames] = useState<GameInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [joiningGameId, setJoiningGameId] = useState<string | null>(null);
  const [deletingGameId, setDeletingGameId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const navigate = useNavigate();

  useEffect(() => {
    loadGames();
    const interval = setInterval(loadGames, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const loadGames = async () => {
    try {
      // Connect first if not connected
      if (!gameClient.isConnected()) {
        await gameClient.connect();
      }

      const gameList = await gameClient.getGameList();
      setGames(gameList);
      setError('');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load games';
      console.error('Failed to load games:', errorMessage);
      setError(`Failed to load games: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBack = () => {
    navigate('/');
  };

  const handleJoinGame = async (gameId: string) => {
    setJoiningGameId(gameId);
    setError('');

    try {
      // Navigate directly to the game URL - user will enter name in the dialog
      navigate(`/game/${gameId}`);
    } catch (err) {
      console.error('Game join error:', err);
      setError(err instanceof Error ? err.message : 'Failed to join game');
      setJoiningGameId(null);
    }
  };

  const handleDeleteGame = async (gameId: string) => {
    setDeletingGameId(gameId);
    setError('');

    try {
      await gameClient.deleteGame(gameId);
      // Refresh the games list after successful deletion
      await loadGames();
    } catch (err) {
      console.error('Game delete error:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete game');
    } finally {
      setDeletingGameId(null);
    }
  };

  // Create columns with action handlers
  const columns = createGameColumns(
    handleJoinGame,
    handleDeleteGame,
    joiningGameId,
    deletingGameId
  );

  return (
    <div className="h-screen bg-gradient-to-b from-amber-100 to-yellow-200 p-4 flex flex-col overflow-hidden">
      <div className="max-w-6xl mx-auto flex-1 flex flex-col w-full min-h-0">
        <div className="bg-transparent md:bg-gradient-to-b md:from-amber-100 md:to-yellow-100 p-4 md:p-6 md:rounded-lg md:shadow-2xl md:border md:border-amber-300 md:shadow-amber-300/20 flex-1 flex flex-col w-full min-h-0 overflow-hidden">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center">
              <button
                onClick={handleBack}
                className="mr-3 p-2 text-amber-600 hover:text-amber-800 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </button>
              <div>
                <h2 className="text-xl md:text-2xl font-bold text-amber-800">Game Lobby</h2>
                <p className="text-amber-600 text-sm md:text-base">Choose a game to join</p>
              </div>
            </div>
            <button
              onClick={loadGames}
              className="px-4 py-2 bg-amber-700 hover:bg-amber-800 text-amber-50 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-amber-600 shadow-sm"
              disabled={isLoading}
            >
              <svg
                className="w-4 h-4 inline mr-2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Refresh
            </button>
          </div>

          {error && (
            <div className="mb-6 p-3 bg-red-50 border border-red-300 rounded-md text-red-800 text-sm">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin w-8 h-8 border-2 border-amber-700 border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-amber-600">Loading games...</p>
            </div>
          ) : games.length === 0 ? (
            <div className="text-center py-12">
              <svg
                className="w-16 h-16 text-amber-500 mx-auto mb-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
              <p className="text-amber-700 text-lg font-medium">No games available</p>
              <p className="text-amber-500 text-sm">Start a new game to begin playing!</p>
            </div>
          ) : (
            <div className="flex-1 w-full min-h-0">
              <DataTable columns={columns} data={games} className="h-full w-full" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
