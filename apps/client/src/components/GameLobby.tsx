import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { gameClient } from '../services/GameClient';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './ui/Table';

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

  const handleDeleteGame = async (gameId: string) => {
    if (!confirm('Are you sure you want to delete this game?')) {
      return;
    }

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
            <Table className="max-h-96">
              <TableHeader>
                <TableRow>
                  <TableHead>Game Name</TableHead>
                  <TableHead>Host</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Players</TableHead>
                  <TableHead>Turn</TableHead>
                  <TableHead>Map Size</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {games.map(game => (
                  <TableRow key={game.id} className={!game.canJoin ? 'opacity-60' : ''}>
                    <TableCell className="font-semibold text-amber-800">{game.name}</TableCell>
                    <TableCell>{game.hostName}</TableCell>
                    <TableCell>
                      <span
                        className={`text-xs font-medium px-2 py-1 rounded-full text-white ${
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
                        <span className="ml-1 text-xs bg-red-500 text-white px-2 py-1 rounded-full">
                          Full
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {game.currentPlayers}/{game.maxPlayers}
                    </TableCell>
                    <TableCell>{game.currentTurn}</TableCell>
                    <TableCell className="capitalize">{game.mapSize}</TableCell>
                    <TableCell>{new Date(game.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => handleJoinGame(game.id)}
                          disabled={!game.canJoin || joiningGameId === game.id}
                          className="px-3 py-1 bg-amber-700 hover:bg-amber-800 disabled:bg-amber-400 disabled:text-amber-200 text-amber-50 text-sm font-medium rounded transition-colors focus:outline-none focus:ring-2 focus:ring-amber-600"
                        >
                          {joiningGameId === game.id ? (
                            <div className="flex items-center">
                              <div className="animate-spin w-3 h-3 border border-amber-300 border-t-transparent rounded-full mr-1"></div>
                              Joining...
                            </div>
                          ) : (
                            'Join'
                          )}
                        </button>
                        <button
                          onClick={() => handleDeleteGame(game.id)}
                          disabled={deletingGameId === game.id}
                          className="px-2 py-1 bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white text-sm rounded transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
                          title="Delete Game"
                        >
                          {deletingGameId === game.id ? (
                            <div className="animate-spin w-3 h-3 border border-white border-t-transparent rounded-full"></div>
                          ) : (
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path
                                fillRule="evenodd"
                                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                clipRule="evenodd"
                              />
                            </svg>
                          )}
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
};
