import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { gameClient } from '../services/GameClient';

interface GameInfo {
  id: string;
  name: string;
  hostName: string;
  status: 'waiting' | 'starting' | 'active' | 'paused' | 'finished';
  currentPlayers: number;
  maxPlayers: number;
  currentTurn: number;
  mapSize: string;
  createdAt: string;
  canJoin: boolean;
}

export const GameLobby: React.FC = () => {
  const [games, setGames] = useState<GameInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [joiningGameId, setJoiningGameId] = useState<string | null>(null);
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
      setError('Failed to load games');
      console.error('Failed to load games:', err);
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

  const getStatusLabel = (status: string) => {
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
    <div className="min-h-screen bg-gradient-to-b from-amber-100 to-yellow-200 p-4">
      <div className="max-w-6xl mx-auto">
        <div className="bg-transparent md:bg-gradient-to-b md:from-amber-100 md:to-yellow-100 p-4 md:p-6 md:rounded-lg md:shadow-2xl md:border md:border-amber-300 md:shadow-amber-300/20">
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
            <div className="space-y-3 md:space-y-4">
              {games.map(game => (
                <div
                  key={game.id}
                  className={`p-4 border rounded-lg transition-all duration-200 bg-gradient-to-r from-amber-100 to-yellow-100 border-amber-400 hover:border-amber-500 hover:bg-gradient-to-r hover:from-amber-200 hover:to-yellow-200 shadow-sm ${
                    !game.canJoin ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 md:gap-0">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                        <h3 className="text-lg font-semibold text-amber-800 truncate">
                          {game.name}
                        </h3>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`text-sm font-medium px-2 py-1 rounded-full text-white ${
                              game.status === 'waiting'
                                ? 'bg-yellow-500'
                                : game.status === 'active'
                                  ? 'bg-green-500'
                                  : game.status === 'paused'
                                    ? 'bg-orange-500'
                                    : game.status === 'finished'
                                      ? 'bg-gray-500'
                                      : 'bg-blue-500'
                            }`}
                          >
                            {getStatusLabel(game.status)}
                          </span>
                          {!game.canJoin && (
                            <span className="text-xs bg-red-500 text-white px-2 py-1 rounded-full">
                              Full
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 mt-3 text-xs md:text-sm text-amber-600">
                        <div className="flex flex-col">
                          <span className="text-amber-400 text-xs uppercase font-medium">Host</span>
                          <span className="truncate">{game.hostName}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-amber-400 text-xs uppercase font-medium">
                            Players
                          </span>
                          <span>
                            {game.currentPlayers}/{game.maxPlayers}
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-amber-400 text-xs uppercase font-medium">Turn</span>
                          <span>{game.currentTurn}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-amber-400 text-xs uppercase font-medium">Map</span>
                          <span className="capitalize">{game.mapSize}</span>
                        </div>
                        <div className="flex flex-col col-span-2 sm:col-span-1">
                          <span className="text-amber-400 text-xs uppercase font-medium">
                            Created
                          </span>
                          <span>{new Date(game.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                    <div className="w-full md:w-auto md:ml-4">
                      <button
                        onClick={() => handleJoinGame(game.id)}
                        disabled={!game.canJoin || joiningGameId === game.id}
                        className="w-full md:w-auto px-6 py-2 bg-amber-700 hover:bg-amber-800 disabled:bg-amber-400 disabled:text-amber-200 text-amber-50 font-medium rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-amber-600 focus:ring-offset-2 focus:ring-offset-amber-100 shadow-sm"
                      >
                        {joiningGameId === game.id ? (
                          <div className="flex items-center">
                            <div className="animate-spin w-4 h-4 border-2 border-amber-300 border-t-transparent rounded-full mr-2"></div>
                            Joining...
                          </div>
                        ) : (
                          'Join Game'
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
