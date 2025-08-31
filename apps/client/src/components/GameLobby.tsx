import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { gameClient } from '../services/GameClient';
import { DataTable } from './ui/DataTable';
import { createGameColumns, type GameInfo } from './GameLobbyColumns';
import { PageBackground } from './shared/PageBackground';

export const GameLobby: React.FC = () => {
  const [games, setGames] = useState<GameInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [joiningGameId, setJoiningGameId] = useState<string | null>(null);
  const [deletingGameId, setDeletingGameId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const navigate = useNavigate();

  useEffect(() => {
    loadGames();
  }, []);

  const loadGames = async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setIsRefreshing(true);
        setError('');
      }

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
      if (isRefresh) {
        setIsRefreshing(false);
      }
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
    <PageBackground
      className="min-h-[100dvh] md:flex md:items-center md:justify-center md:p-4"
      showBackground={false}
    >
      <div className="flex flex-col h-[100dvh] md:h-auto md:max-w-4xl xl:max-w-5xl md:mx-auto">
        <div className="bg-transparent md:bg-card md:border md:border-border md:shadow-2xl p-4 md:p-8 md:rounded-lg w-full flex-1 md:flex-none overflow-y-auto">
          {/* Header Section */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-4 md:mb-6">
              <div className="flex items-center">
                <button
                  onClick={handleBack}
                  className="mr-3 p-2 text-muted-foreground hover:text-foreground transition-colors"
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
                  <h2 className="text-xl md:text-2xl font-bold text-foreground">Game Lobby</h2>
                  <p className="text-muted-foreground text-sm md:text-base">
                    Choose a game to join
                  </p>
                </div>
              </div>

              {/* Desktop refresh button */}
              <button
                onClick={() => loadGames(true)}
                className="hidden md:flex items-center px-4 py-2 bg-primary hover:bg-primary/90 disabled:bg-primary/50 text-primary-foreground rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-ring shadow-sm"
                disabled={isRefreshing}
              >
                {isRefreshing ? (
                  <>
                    <div className="animate-spin w-4 h-4 border border-primary-foreground/30 border-t-transparent rounded-full mr-2"></div>
                    Refreshing...
                  </>
                ) : (
                  <>
                    <svg
                      className="w-4 h-4 mr-2"
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
                  </>
                )}
              </button>
            </div>

            {/* Mobile refresh button - full width below header */}
            <button
              onClick={() => loadGames(true)}
              className="md:hidden w-full flex items-center justify-center px-4 py-3 bg-primary hover:bg-primary/90 disabled:bg-primary/50 text-primary-foreground rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-ring shadow-sm font-medium"
              disabled={isRefreshing}
            >
              {isRefreshing ? (
                <>
                  <div className="animate-spin w-4 h-4 border border-primary-foreground/30 border-t-transparent rounded-full mr-2"></div>
                  Refreshing...
                </>
              ) : (
                <>
                  <svg
                    className="w-4 h-4 mr-2"
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
                  Refresh Games
                </>
              )}
            </button>
          </div>

          {error && (
            <div className="mb-6 p-3 bg-red-50 border border-red-300 rounded-md text-red-800 text-sm">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-muted-foreground">Loading games...</p>
            </div>
          ) : games.length === 0 ? (
            <div className="text-center py-12">
              <svg
                className="w-16 h-16 text-muted-foreground mx-auto mb-4"
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
              <p className="text-foreground text-lg font-medium">No games available</p>
              <p className="text-muted-foreground text-sm">Start a new game to begin playing!</p>
            </div>
          ) : (
            <div className="flex-1 w-full min-h-0">
              <DataTable columns={columns} data={games} className="h-full w-full" />
            </div>
          )}
        </div>
      </div>
    </PageBackground>
  );
};
