import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { gameClient } from '../services/GameClient';

export const GameCreationDialog: React.FC = () => {
  const [playerName, setPlayerName] = useState('');
  const [gameName, setGameName] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [mapSize, setMapSize] = useState('standard');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const navigate = useNavigate();

  const handleBack = () => {
    navigate('/');
  };

  const handleCreateGame = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!playerName.trim()) {
      setError('Please enter a player name');
      return;
    }

    if (!gameName.trim()) {
      setError('Please enter a game name');
      return;
    }

    setIsCreating(true);
    setError('');

    try {
      await gameClient.connect();
      
      // Create the game (server will handle authentication)
      const gameId = await gameClient.createGame({
        gameName: gameName.trim(),
        playerName: playerName.trim(),
        maxPlayers,
        mapSize,
      });
      
      // Navigate to the game URL
      navigate(`/game/${gameId}`);
    } catch (err) {
      console.error('Game creation error:', err);
      setError(err instanceof Error ? err.message : 'Failed to create game');
    } finally {
      setIsCreating(false);
    }
  };

  const mapSizeOptions = [
    { value: 'small', label: 'Small (40x25)', description: '2-4 players' },
    { value: 'standard', label: 'Standard (80x50)', description: '4-6 players' },
    { value: 'large', label: 'Large (120x75)', description: '6-8 players' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-900 to-blue-800 flex items-center justify-center">
      <div className="bg-gray-800 p-8 rounded-lg shadow-2xl w-[500px] border border-gray-700">
        <div className="flex items-center mb-6">
          <button
            onClick={handleBack}
            className="mr-4 p-2 text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h2 className="text-2xl font-bold text-white">Create New Game</h2>
            <p className="text-gray-300">Set up your civilization</p>
          </div>
        </div>

        <form onSubmit={handleCreateGame} className="space-y-6">
          <div>
            <label htmlFor="playerName" className="block text-sm font-medium text-gray-300 mb-2">
              Your Name
            </label>
            <input
              id="playerName"
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Enter your player name"
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              disabled={isCreating}
              maxLength={32}
            />
          </div>

          <div>
            <label htmlFor="gameName" className="block text-sm font-medium text-gray-300 mb-2">
              Game Name
            </label>
            <input
              id="gameName"
              type="text"
              value={gameName}
              onChange={(e) => setGameName(e.target.value)}
              placeholder="Enter game name"
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              disabled={isCreating}
              maxLength={50}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="maxPlayers" className="block text-sm font-medium text-gray-300 mb-2">
                Max Players
              </label>
              <select
                id="maxPlayers"
                value={maxPlayers}
                onChange={(e) => setMaxPlayers(Number(e.target.value))}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                disabled={isCreating}
              >
                <option value={2}>2 Players</option>
                <option value={3}>3 Players</option>
                <option value={4}>4 Players</option>
                <option value={6}>6 Players</option>
                <option value={8}>8 Players</option>
              </select>
            </div>

            <div>
              <label htmlFor="mapSize" className="block text-sm font-medium text-gray-300 mb-2">
                Map Size
              </label>
              <select
                id="mapSize"
                value={mapSize}
                onChange={(e) => setMapSize(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                disabled={isCreating}
              >
                {mapSizeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="bg-gray-700 p-4 rounded-md">
            <h4 className="text-sm font-medium text-gray-300 mb-2">Map Preview</h4>
            {mapSizeOptions.map((option) => (
              mapSize === option.value && (
                <div key={option.value} className="text-sm text-gray-400">
                  <p>{option.label}</p>
                  <p>{option.description}</p>
                </div>
              )
            ))}
          </div>

          {error && (
            <div className="p-3 bg-red-900 border border-red-700 rounded-md text-red-200 text-sm">
              {error}
            </div>
          )}

          <div className="flex space-x-4">
            <button
              type="button"
              onClick={handleBack}
              className="flex-1 py-3 px-4 bg-gray-600 hover:bg-gray-700 text-white font-medium rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-gray-800"
              disabled={isCreating}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isCreating || !playerName.trim() || !gameName.trim()}
              className="flex-1 py-3 px-4 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:text-gray-400 text-white font-medium rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-800"
            >
              {isCreating ? (
                <div className="flex items-center justify-center">
                  <div className="animate-spin w-5 h-5 border-2 border-green-300 border-t-transparent rounded-full mr-2"></div>
                  Creating...
                </div>
              ) : (
                'Create Game'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};