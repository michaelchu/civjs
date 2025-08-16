import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGameStore } from '../stores/gameStore';
import type { Game } from '../../../shared/types';

export default function GamesList() {
  const navigate = useNavigate();
  const {
    games,
    loading,
    error,
    loadGames,
    clearError,
    setCurrentGame,
    deleteGame,
  } = useGameStore();
  const [gameToDelete, setGameToDelete] = useState<Game | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleSelectGame = (game: Game) => {
    setCurrentGame(game);
    navigate(`/games/${game.id}/lobby`);
  };

  const handleDeleteClick = (e: React.MouseEvent, game: Game) => {
    e.stopPropagation();
    setGameToDelete(game);
  };

  const handleConfirmDelete = async () => {
    if (!gameToDelete) return;

    setIsDeleting(true);
    const success = await deleteGame(gameToDelete.id);
    setIsDeleting(false);

    if (success) {
      setGameToDelete(null);
    }
  };

  const handleCancelDelete = () => {
    setGameToDelete(null);
  };

  useEffect(() => {
    loadGames();
  }, [loadGames]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        <span className="ml-2 text-gray-600">Loading games...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <div className="text-red-400">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <span className="ml-2 text-red-800">{error}</span>
          </div>
          <button
            onClick={clearError}
            className="text-red-600 hover:text-red-800"
          >
            ×
          </button>
        </div>
        <button
          onClick={loadGames}
          className="mt-2 bg-red-100 hover:bg-red-200 text-red-800 px-3 py-1 rounded text-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="text-gray-400 mb-4">
          <svg
            className="w-16 h-16 mx-auto"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          No games available
        </h3>
        <p className="text-gray-500">Create a new game to get started!</p>
      </div>
    );
  }

  const getStatusColor = (status: Game['status']) => {
    switch (status) {
      case 'waiting':
        return 'bg-yellow-100 text-yellow-800';
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'completed':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status: Game['status']) => {
    switch (status) {
      case 'waiting':
        return 'Waiting for players';
      case 'active':
        return 'In progress';
      case 'completed':
        return 'Completed';
      default:
        return status;
    }
  };

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <Link
            to="/"
            className="text-gray-600 hover:text-gray-800 flex items-center"
          >
            <svg
              className="w-5 h-5 mr-1"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z"
                clipRule="evenodd"
              />
            </svg>
            Back to Home
          </Link>
          <Link
            to="/games/create"
            className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg font-medium"
          >
            Create New Game
          </Link>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-900">
              Available Games
            </h2>
            <button
              onClick={loadGames}
              className="text-blue-600 hover:text-blue-800 flex items-center"
            >
              <svg
                className="w-4 h-4 mr-1"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
                  clipRule="evenodd"
                />
              </svg>
              Refresh
            </button>
          </div>

          <div className="grid gap-4">
            {games.map(game => (
              <div
                key={game.id}
                className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => handleSelectGame(game)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900">
                      {game.name}
                    </h3>
                    <div className="mt-2 flex items-center space-x-4 text-sm text-gray-500">
                      <span>Turn {game.currentTurn}</span>
                      <span>Max {game.maxPlayers} players</span>
                      <span>Map: {game.settings.mapSize}</span>
                    </div>
                    <div className="mt-2">
                      <span
                        className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(game.status)}`}
                      >
                        {getStatusText(game.status)}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-gray-500">
                      Created {new Date(game.createdAt).toLocaleDateString()}
                    </div>
                    <div className="mt-2 flex gap-2 justify-end items-stretch">
                      <button
                        className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium"
                        onClick={e => {
                          e.stopPropagation();
                          handleSelectGame(game);
                        }}
                      >
                        {game.status === 'waiting' ? 'Join Game' : 'View Game'}
                      </button>
                      <button
                        className="bg-red-500 hover:bg-red-600 text-white px-3 py-2 rounded text-sm font-medium flex items-center justify-center"
                        onClick={e => handleDeleteClick(e, game)}
                        title="Delete game"
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
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {gameToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Confirm Delete
            </h3>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete the game "{gameToDelete.name}"?
              This action cannot be undone and will remove all game data
              including the map, units, and player progress.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                className="px-4 py-2 text-gray-700 bg-gray-200 hover:bg-gray-300 rounded font-medium"
                onClick={handleCancelDelete}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded font-medium"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Delete Game'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
