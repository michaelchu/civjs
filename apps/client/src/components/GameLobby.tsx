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
  const [playerName, setPlayerName] = useState('');
  const [games, setGames] = useState<GameInfo[]>([]);
  const [selectedGame, setSelectedGame] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isJoining, setIsJoining] = useState(false);
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

  const handleJoinGame = async () => {
    if (!selectedGame || !playerName.trim()) {
      setError('Please select a game and enter your player name');
      return;
    }

    setIsJoining(true);
    setError('');

    try {
      // Navigate directly to the game URL with player name as a query parameter
      navigate(
        `/game/${selectedGame}?playerName=${encodeURIComponent(playerName.trim())}`
      );
    } catch (err) {
      console.error('Game join error:', err);
      setError(err instanceof Error ? err.message : 'Failed to join game');
      setIsJoining(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'waiting':
        return 'text-yellow-400';
      case 'active':
        return 'text-green-400';
      case 'paused':
        return 'text-orange-400';
      case 'finished':
        return 'text-gray-400';
      default:
        return 'text-blue-400';
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
    <div className="min-h-screen bg-gradient-to-b from-blue-900 to-blue-800 p-4">
      <div className="max-w-6xl mx-auto">
        <div className="bg-gray-800 p-6 rounded-lg shadow-2xl border border-gray-700">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center">
              <button
                onClick={handleBack}
                className="mr-4 p-2 text-gray-400 hover:text-white transition-colors"
              >
                <svg
                  className="w-5 h-5"
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
              </button>
              <div>
                <h2 className="text-2xl font-bold text-white">Game Lobby</h2>
                <p className="text-gray-300">Choose a game to join</p>
              </div>
            </div>
            <button
              onClick={loadGames}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
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

          <div className="mb-6">
            <label
              htmlFor="playerName"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
              Your Player Name
            </label>
            <input
              id="playerName"
              type="text"
              value={playerName}
              onChange={e => setPlayerName(e.target.value)}
              placeholder="Enter your name to join a game"
              className="w-full max-w-md px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              maxLength={32}
            />
          </div>

          {error && (
            <div className="mb-6 p-3 bg-red-900 border border-red-700 rounded-md text-red-200 text-sm">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-gray-300">Loading games...</p>
            </div>
          ) : games.length === 0 ? (
            <div className="text-center py-12">
              <svg
                className="w-16 h-16 text-gray-500 mx-auto mb-4"
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
              <p className="text-gray-300 text-lg">No games available</p>
              <p className="text-gray-500 text-sm">
                Start a new game to begin playing!
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {games.map(game => (
                <div
                  key={game.id}
                  className={`p-4 border rounded-lg cursor-pointer transition-all duration-200 ${
                    selectedGame === game.id
                      ? 'border-blue-500 bg-blue-900/30'
                      : 'border-gray-600 bg-gray-700/50 hover:border-gray-500 hover:bg-gray-700'
                  } ${!game.canJoin ? 'opacity-50 cursor-not-allowed' : ''}`}
                  onClick={() => game.canJoin && setSelectedGame(game.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3">
                        <h3 className="text-lg font-semibold text-white">
                          {game.name}
                        </h3>
                        <span
                          className={`text-sm font-medium ${getStatusColor(game.status)}`}
                        >
                          {getStatusLabel(game.status)}
                        </span>
                        {!game.canJoin && (
                          <span className="text-xs bg-red-600 text-white px-2 py-1 rounded">
                            Full
                          </span>
                        )}
                      </div>
                      <div className="flex items-center space-x-6 mt-2 text-sm text-gray-400">
                        <span>Host: {game.hostName}</span>
                        <span>
                          Players: {game.currentPlayers}/{game.maxPlayers}
                        </span>
                        <span>Turn: {game.currentTurn}</span>
                        <span>Map: {game.mapSize}</span>
                        <span>
                          Created:{' '}
                          {new Date(game.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    {selectedGame === game.id && (
                      <div className="ml-4">
                        <svg
                          className="w-6 h-6 text-blue-400"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {games.length > 0 && (
            <div className="mt-6 flex justify-end">
              <button
                onClick={handleJoinGame}
                disabled={!selectedGame || !playerName.trim() || isJoining}
                className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:text-gray-400 text-white font-medium rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-800"
              >
                {isJoining ? (
                  <div className="flex items-center">
                    <div className="animate-spin w-5 h-5 border-2 border-green-300 border-t-transparent rounded-full mr-2"></div>
                    Joining...
                  </div>
                ) : (
                  'Join Selected Game'
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
