import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export const GameCreationDialog: React.FC = () => {
  const [playerName, setPlayerName] = useState('');
  const [gameName, setGameName] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [mapSize, setMapSize] = useState('standard');
  const [error, setError] = useState('');

  const navigate = useNavigate();

  const handleBack = () => {
    navigate('/');
  };

  const handleNext = (e: React.FormEvent) => {
    e.preventDefault();

    if (!playerName.trim()) {
      setError('Please enter a player name');
      return;
    }

    if (!gameName.trim()) {
      setError('Please enter a game name');
      return;
    }

    // Navigate to terrain settings with game parameters
    navigate('/terrain-settings', {
      state: {
        playerName: playerName.trim(),
        gameName: gameName.trim(),
        maxPlayers,
        mapSize,
      },
    });
  };

  const mapSizeOptions = [
    { value: 'small', label: 'Small (40x25)', description: '2-4 players' },
    {
      value: 'standard',
      label: 'Standard (80x50)',
      description: '4-6 players',
    },
    { value: 'large', label: 'Large (120x75)', description: '6-8 players' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-yellow-100 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-gradient-to-b from-amber-50 to-yellow-50 p-6 md:p-8 rounded-lg shadow-2xl w-full max-w-md mx-auto border border-amber-200 shadow-amber-200/20">
        <div className="flex items-center mb-6">
          <button
            onClick={handleBack}
            className="mr-3 p-2 text-amber-700 hover:text-amber-900 transition-colors"
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
            <h2 className="text-2xl font-bold text-amber-900">
              Create New Game
            </h2>
            <p className="text-amber-700">Set up your civilization</p>
          </div>
        </div>

        <form onSubmit={handleNext} className="space-y-6">
          <div>
            <label
              htmlFor="playerName"
              className="block text-sm font-medium text-amber-800 mb-2"
            >
              Your Name
            </label>
            <input
              id="playerName"
              type="text"
              value={playerName}
              onChange={e => setPlayerName(e.target.value)}
              placeholder="Enter your player name"
              className="w-full px-3 py-3 bg-amber-50 border border-amber-300 rounded-md text-amber-900 placeholder-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 shadow-sm"
              maxLength={32}
            />
          </div>

          <div>
            <label
              htmlFor="gameName"
              className="block text-sm font-medium text-amber-800 mb-2"
            >
              Game Name
            </label>
            <input
              id="gameName"
              type="text"
              value={gameName}
              onChange={e => setGameName(e.target.value)}
              placeholder="Enter game name"
              className="w-full px-3 py-3 bg-amber-50 border border-amber-300 rounded-md text-amber-900 placeholder-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 shadow-sm"
              maxLength={50}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="maxPlayers"
                className="block text-sm font-medium text-amber-800 mb-2"
              >
                Max Players
              </label>
              <select
                id="maxPlayers"
                value={maxPlayers}
                onChange={e => setMaxPlayers(Number(e.target.value))}
                className="w-full px-3 py-3 bg-amber-50 border border-amber-300 rounded-md text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 shadow-sm"
              >
                <option value={2}>2 Players</option>
                <option value={3}>3 Players</option>
                <option value={4}>4 Players</option>
                <option value={6}>6 Players</option>
                <option value={8}>8 Players</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="mapSize"
                className="block text-sm font-medium text-amber-800 mb-2"
              >
                Map Size
              </label>
              <select
                id="mapSize"
                value={mapSize}
                onChange={e => setMapSize(e.target.value)}
                className="w-full px-3 py-3 bg-amber-50 border border-amber-300 rounded-md text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 shadow-sm"
              >
                {mapSizeOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="bg-amber-100 border border-amber-200 p-4 rounded-md">
            <h4 className="text-sm font-medium text-amber-800 mb-2">
              Map Preview
            </h4>
            {mapSizeOptions.map(
              option =>
                mapSize === option.value && (
                  <div key={option.value} className="text-sm text-amber-700">
                    <p className="font-medium">{option.label}</p>
                    <p>{option.description}</p>
                  </div>
                )
            )}
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-300 rounded-md text-red-800 text-sm">
              {error}
            </div>
          )}

          <div className="flex space-x-4">
            <button
              type="button"
              onClick={handleBack}
              className="flex-1 py-3 px-4 bg-amber-200 hover:bg-amber-300 text-amber-800 font-medium rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-amber-50 shadow-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!playerName.trim() || !gameName.trim()}
              className="flex-1 py-3 px-4 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 disabled:text-amber-500 text-amber-50 font-medium rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-amber-50 shadow-sm"
            >
              Next
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
