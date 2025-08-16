import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGameStore } from '../stores/gameStore';

const CIVILIZATION_OPTIONS = [
  'Romans',
  'Greeks',
  'Egyptians',
  'Chinese',
  'Aztecs',
  'Vikings',
];

export default function GameLobby() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { currentGame, joinGame, startGame, loading, error, clearError } =
    useGameStore();
  const [showJoinForm, setShowJoinForm] = useState(false);
  const [selectedCivilization, setSelectedCivilization] = useState(
    CIVILIZATION_OPTIONS[0]
  );

  useEffect(() => {
    // Clear any previous errors when component mounts
    clearError();
  }, [clearError]);

  const handleJoinGame = async () => {
    if (!gameId) return;
    const success = await joinGame(gameId, selectedCivilization);
    if (success) {
      setShowJoinForm(false);
    }
  };

  const handleStartGame = async () => {
    if (!gameId) return;
    const success = await startGame(gameId);
    if (success) {
      navigate(`/games/${gameId}/play`);
    }
  };

  // Redirect if no current game or game ID doesn't match
  useEffect(() => {
    if (!currentGame || currentGame.id !== gameId) {
      navigate('/games');
    }
  }, [currentGame, gameId, navigate]);

  if (!currentGame || currentGame.id !== gameId) {
    return null; // Will redirect
  }

  // Mock player data - in real implementation this would come from the game object
  const players = [
    { id: '1', username: 'Player1', civilization: 'Romans', isActive: true },
    { id: '2', username: 'Player2', civilization: 'Greeks', isActive: true },
  ];

  const canStartGame = currentGame.status === 'waiting' && players.length >= 2;

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      {/* Header */}
      <div className="border-b border-gray-200 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              {currentGame.name}
            </h1>
            <p className="text-gray-600 mt-2">
              Turn {currentGame.currentTurn} •{' '}
              {currentGame.settings.mapSize.charAt(0).toUpperCase() +
                currentGame.settings.mapSize.slice(1)}{' '}
              Map
            </p>
          </div>
          <button
            onClick={() => navigate('/games')}
            className="text-gray-500 hover:text-gray-700 flex items-center"
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
            Back to Games
          </button>
        </div>
      </div>

      <div className="p-6">
        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <div className="text-red-400">
                  <svg
                    className="w-5 h-5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
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
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Players List */}
          <div className="lg:col-span-2">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Players ({players.length}/{currentGame.maxPlayers})
            </h2>

            <div className="space-y-3">
              {players.map(player => (
                <div
                  key={player.id}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                >
                  <div className="flex items-center">
                    <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white font-medium">
                      {player.username.charAt(0).toUpperCase()}
                    </div>
                    <div className="ml-3">
                      <div className="text-sm font-medium text-gray-900">
                        {player.username}
                      </div>
                      <div className="text-sm text-gray-500">
                        {player.civilization}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center">
                    <div
                      className={`w-3 h-3 rounded-full ${player.isActive ? 'bg-green-400' : 'bg-gray-400'}`}
                    ></div>
                    <span className="ml-2 text-sm text-gray-600">
                      {player.isActive ? 'Ready' : 'Away'}
                    </span>
                  </div>
                </div>
              ))}

              {/* Empty player slots */}
              {Array.from({
                length: currentGame.maxPlayers - players.length,
              }).map((_, index) => (
                <div
                  key={`empty-${index}`}
                  className="flex items-center p-4 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300"
                >
                  <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center">
                    <svg
                      className="w-5 h-5 text-gray-500"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 016 6H2a6 6 0 016-6zM16 7a1 1 0 10-2 0v1h-1a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V7z" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <div className="text-sm font-medium text-gray-500">
                      Waiting for player...
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Join Game Button */}
            {currentGame.status === 'waiting' &&
              players.length < currentGame.maxPlayers && (
                <div className="mt-4">
                  {!showJoinForm ? (
                    <button
                      onClick={() => setShowJoinForm(true)}
                      className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg font-medium"
                    >
                      Join Game
                    </button>
                  ) : (
                    <div className="bg-white border border-gray-300 rounded-lg p-4">
                      <h3 className="text-lg font-medium text-gray-900 mb-3">
                        Choose Your Civilization
                      </h3>
                      <div className="grid grid-cols-2 gap-2 mb-4">
                        {CIVILIZATION_OPTIONS.map(civ => (
                          <label
                            key={civ}
                            className={`flex items-center p-3 border rounded cursor-pointer hover:bg-gray-50 ${
                              selectedCivilization === civ
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-gray-300'
                            }`}
                          >
                            <input
                              type="radio"
                              name="civilization"
                              value={civ}
                              checked={selectedCivilization === civ}
                              onChange={e =>
                                setSelectedCivilization(e.target.value)
                              }
                              className="sr-only"
                            />
                            <span className="text-sm font-medium">{civ}</span>
                          </label>
                        ))}
                      </div>
                      <div className="flex space-x-2">
                        <button
                          onClick={handleJoinGame}
                          disabled={loading}
                          className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded font-medium disabled:opacity-50 flex items-center"
                        >
                          {loading && (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                          )}
                          Confirm Join
                        </button>
                        <button
                          onClick={() => setShowJoinForm(false)}
                          className="bg-gray-300 hover:bg-gray-400 text-gray-700 px-4 py-2 rounded font-medium"
                          disabled={loading}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
          </div>

          {/* Game Settings */}
          <div>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Game Settings
            </h2>
            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Map Size</span>
                <span className="text-sm font-medium text-gray-900">
                  {currentGame.settings.mapSize.charAt(0).toUpperCase() +
                    currentGame.settings.mapSize.slice(1)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Turn Timer</span>
                <span className="text-sm font-medium text-gray-900">
                  {Math.floor(currentGame.settings.turnTimer / 60)}:
                  {String(currentGame.settings.turnTimer % 60).padStart(2, '0')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Spectators</span>
                <span className="text-sm font-medium text-gray-900">
                  {currentGame.settings.allowSpectators
                    ? 'Allowed'
                    : 'Not allowed'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Status</span>
                <span
                  className={`text-sm font-medium ${
                    currentGame.status === 'waiting'
                      ? 'text-yellow-600'
                      : currentGame.status === 'active'
                        ? 'text-green-600'
                        : 'text-gray-600'
                  }`}
                >
                  {currentGame.status.charAt(0).toUpperCase() +
                    currentGame.status.slice(1)}
                </span>
              </div>
            </div>

            {/* Start Game Button */}
            {canStartGame && (
              <button
                onClick={handleStartGame}
                disabled={loading}
                className="w-full mt-4 bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-lg font-medium disabled:opacity-50 flex items-center justify-center"
              >
                {loading && (
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                )}
                Start Game
              </button>
            )}

            {currentGame.status === 'active' && (
              <button
                onClick={handleStartGame}
                className="w-full mt-4 bg-green-600 hover:bg-green-700 text-white px-4 py-3 rounded-lg font-medium"
              >
                Enter Game
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
