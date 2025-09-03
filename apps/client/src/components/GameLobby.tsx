import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { gameClient } from '../services/GameClient';
import { DataTable } from './ui/DataTable';
import { createGameColumns, type GameInfo } from './GameLobbyColumns';
import { PageBackground } from './shared/PageBackground';
import { Button } from './ui/button';

export const GameLobby: React.FC = () => {
  const [games, setGames] = useState<GameInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [joiningGameId, setJoiningGameId] = useState<string | null>(null);
  const [deletingGameId, setDeletingGameId] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10); // Show 10 games per page

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

  // Pagination calculations
  const totalPages = Math.ceil(games.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentGames = games.slice(startIndex, endIndex);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  // Reset to first page when games change
  useEffect(() => {
    setCurrentPage(1);
  }, [games.length]);

  // Create columns with action handlers
  const columns = createGameColumns(
    handleJoinGame,
    handleDeleteGame,
    joiningGameId,
    deletingGameId
  );

  return (
    <PageBackground className="min-h-[100dvh] flex flex-col" showBackground={false}>
      <div className="flex-1 flex flex-col max-w-6xl mx-auto w-full p-4 md:p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 flex-shrink-0">
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
        <div className="md:hidden mb-6 flex-shrink-0">
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
          <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive flex-shrink-0">
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

        {/* Content - Scrollable Area */}
        <div className="flex-1 flex flex-col min-h-0">
          {isLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="animate-spin w-12 h-12 border-2 border-primary border-t-transparent rounded-full mx-auto mb-6"></div>
                <h3 className="text-lg font-semibold mb-2">Loading Games</h3>
                <p className="text-muted-foreground">Discovering active civilizations...</p>
              </div>
            </div>
          ) : games.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
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
                      d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                    />
                  </svg>
                  Create New Game
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* DataTable - Scrollable */}
              <div className="flex-1 overflow-hidden">
                <DataTable columns={columns} data={currentGames} className="h-full" />
              </div>

              {/* Fixed Pagination Controls */}
              <div className="flex-shrink-0 pt-6 border-t border-border/20 mt-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    Showing {startIndex + 1} to {Math.min(endIndex, games.length)} of {games.length}{' '}
                    games
                  </div>

                  {totalPages > 1 && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handlePreviousPage}
                        disabled={currentPage === 1}
                      >
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
                            d="M15 19l-7-7 7-7"
                          />
                        </svg>
                        Previous
                      </Button>

                      <div className="flex items-center gap-1">
                        {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                          let pageNumber;
                          if (totalPages <= 7) {
                            pageNumber = i + 1;
                          } else if (currentPage <= 4) {
                            pageNumber = i + 1;
                          } else if (currentPage >= totalPages - 3) {
                            pageNumber = totalPages - 6 + i;
                          } else {
                            pageNumber = currentPage - 3 + i;
                          }
                          return (
                            <Button
                              key={pageNumber}
                              variant={currentPage === pageNumber ? 'default' : 'outline'}
                              size="sm"
                              onClick={() => handlePageChange(pageNumber)}
                              className="min-w-[40px]"
                            >
                              {pageNumber}
                            </Button>
                          );
                        })}
                        {totalPages > 7 && currentPage < totalPages - 3 && (
                          <>
                            <span className="px-2 text-muted-foreground">...</span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handlePageChange(totalPages)}
                              className="min-w-[40px]"
                            >
                              {totalPages}
                            </Button>
                          </>
                        )}
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleNextPage}
                        disabled={currentPage === totalPages}
                      >
                        Next
                        <svg
                          className="w-4 h-4 ml-2"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </PageBackground>
  );
};
