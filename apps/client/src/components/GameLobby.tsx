import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { gameClient } from '../services/GameClient';
import { type GameInfo } from './GameLobbyColumns';
import { PageBackground } from './shared/PageBackground';
import { Button } from './ui/button';

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

  const getStatusColor = (status: GameInfo['status']) => {
    switch (status) {
      case 'waiting':
        return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
      case 'active':
        return 'bg-green-500/10 text-green-600 border-green-500/20';
      case 'paused':
        return 'bg-orange-500/10 text-orange-600 border-orange-500/20';
      case 'finished':
        return 'bg-gray-500/10 text-gray-600 border-gray-500/20';
      default:
        return 'bg-blue-500/10 text-blue-600 border-blue-500/20';
    }
  };

  const getStatusLabel = (status: GameInfo['status']) => {
    switch (status) {
      case 'waiting':
        return 'Waiting for Players';
      case 'starting':
        return 'Starting';
      case 'active':
        return 'In Progress';
      case 'paused':
        return 'Paused';
      case 'finished':
        return 'Finished';
      default:
        return status;
    }
  };

  return (
    <PageBackground className="min-h-[100dvh] p-4 md:p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleBack}
              className="hover:bg-background/80"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </Button>
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                Game Lobby
              </h1>
              <p className="text-muted-foreground mt-1">
                Choose a game to join and start your civilization
              </p>
            </div>
          </div>

          <Button
            onClick={() => loadGames(true)}
            disabled={isRefreshing}
            variant="outline"
            className="hidden md:flex"
          >
            {isRefreshing ? (
              <>
                <div className="animate-spin w-4 h-4 border border-current/30 border-t-transparent rounded-full mr-2"></div>
                Refreshing...
              </>
            ) : (
              <>
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          </Button>
        </div>

        {/* Mobile refresh button */}
        <div className="md:hidden mb-6">
          <Button onClick={() => loadGames(true)} disabled={isRefreshing} className="w-full">
            {isRefreshing ? (
              <>
                <div className="animate-spin w-4 h-4 border border-current/30 border-t-transparent rounded-full mr-2"></div>
                Refreshing...
              </>
            ) : (
              <>
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          </Button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive">
            <div className="flex items-center gap-2">
              <svg
                className="w-4 h-4 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              {error}
            </div>
          </div>
        )}

        {/* Content */}
        {isLoading ? (
          <div className="text-center py-16">
            <div className="animate-spin w-12 h-12 border-2 border-primary border-t-transparent rounded-full mx-auto mb-6"></div>
            <h3 className="text-lg font-semibold mb-2">Loading Games</h3>
            <p className="text-muted-foreground">Discovering active civilizations...</p>
          </div>
        ) : games.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-20 h-20 bg-muted/50 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg
                className="w-10 h-10 text-muted-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
            </div>
            <h3 className="text-xl font-semibold mb-2">No Active Games</h3>
            <p className="text-muted-foreground mb-6">Be the first to start a civilization!</p>
            <Button onClick={() => navigate('/create-game')}>
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                />
              </svg>
              Create New Game
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {games.map(game => (
              <div
                key={game.id}
                className="group bg-background/50 backdrop-blur-sm border border-border/50 rounded-2xl p-6 hover:bg-background/80 hover:border-border/80 transition-all duration-300 hover:shadow-lg"
              >
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  {/* Game Info */}
                  <div className="flex-1 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-xl font-semibold text-foreground group-hover:text-foreground/90 transition-colors">
                          {game.name}
                        </h3>
                        <p className="text-muted-foreground mt-1">Hosted by {game.hostName}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div
                          className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(game.status)}`}
                        >
                          {getStatusLabel(game.status)}
                        </div>
                        {!game.canJoin && (
                          <div className="px-3 py-1 rounded-full text-xs font-medium bg-destructive/10 text-destructive border border-destructive/20">
                            Full
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Game Stats */}
                    <div className="flex items-center gap-6 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z"
                          />
                        </svg>
                        <span>
                          {game.currentPlayers}/{game.maxPlayers} players
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                        <span>Turn {game.currentTurn}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
                          />
                        </svg>
                        <span className="capitalize">{game.mapSize}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                          />
                        </svg>
                        <span>{new Date(game.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-3">
                    <Button
                      onClick={() => handleJoinGame(game.id)}
                      disabled={!game.canJoin || joiningGameId === game.id}
                      size="lg"
                      className="min-w-[100px]"
                    >
                      {joiningGameId === game.id ? (
                        <>
                          <div className="animate-spin w-4 h-4 border border-current/30 border-t-transparent rounded-full mr-2"></div>
                          Joining...
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
                              d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"
                            />
                          </svg>
                          Join Game
                        </>
                      )}
                    </Button>

                    <Button
                      onClick={async () => {
                        if (
                          window.confirm(
                            `Are you sure you want to delete "${game.name}"? This action cannot be undone.`
                          )
                        ) {
                          await handleDeleteGame(game.id);
                        }
                      }}
                      disabled={deletingGameId === game.id}
                      variant="destructive"
                      size="icon"
                      className="flex-shrink-0"
                    >
                      {deletingGameId === game.id ? (
                        <div className="animate-spin w-4 h-4 border border-current/30 border-t-transparent rounded-full"></div>
                      ) : (
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageBackground>
  );
};
