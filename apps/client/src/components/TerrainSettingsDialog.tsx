import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { gameClient } from '../services/GameClient';

interface GameCreationState {
  playerName: string;
  gameName: string;
  maxPlayers: number;
  mapSize: string;
}

interface TerrainSettings {
  generator: string;
  landmass: string;
  huts: number;
  temperature: number;
  wetness: number;
  rivers: number;
  resources: string;
}

export const TerrainSettingsDialog: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const [terrainSettings, setTerrainSettings] = useState<TerrainSettings>({
    generator: 'fractal',
    landmass: 'normal',
    huts: 15,
    temperature: 50,
    wetness: 50,
    rivers: 50,
    resources: 'normal',
  });

  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');

  const gameData = location.state as GameCreationState;

  if (!gameData) {
    navigate('/create-game');
    return null;
  }

  const handleBack = () => {
    navigate('/create-game');
  };

  const handleCreateGame = async (e: React.FormEvent) => {
    e.preventDefault();

    setIsCreating(true);
    setError('');

    try {
      await gameClient.connect();

      const gameId = await gameClient.createGame({
        gameName: gameData.gameName,
        playerName: gameData.playerName,
        maxPlayers: gameData.maxPlayers,
        mapSize: gameData.mapSize,
        terrainSettings,
      });

      navigate(`/game/${gameId}`);
    } catch (err) {
      console.error('Game creation error:', err);
      setError(err instanceof Error ? err.message : 'Failed to create game');
    } finally {
      setIsCreating(false);
    }
  };

  const generatorOptions = [
    {
      value: 'fractal',
      label: 'Fractal',
      description: 'Realistic continent shapes',
    },
    { value: 'island', label: 'Island', description: 'Island-based map' },
    { value: 'fair', label: 'Fair', description: 'Balanced for all players' },
    { value: 'scenario', label: 'Scenario', description: 'Pre-designed map' },
  ];

  const landmassOptions = [
    { value: 'sparse', label: 'Sparse (30%)', description: 'Lots of water' },
    {
      value: 'normal',
      label: 'Normal (50%)',
      description: 'Balanced land/water',
    },
    { value: 'dense', label: 'Dense (70%)', description: 'Mostly land' },
  ];

  const resourceOptions = [
    {
      value: 'sparse',
      label: 'Sparse',
      description: 'Few strategic resources',
    },
    { value: 'normal', label: 'Normal', description: 'Balanced resources' },
    { value: 'abundant', label: 'Abundant', description: 'Many resources' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-900 to-blue-800 flex items-center justify-center">
      <div className="bg-gray-800 p-8 rounded-lg shadow-2xl w-[600px] border border-gray-700">
        <div className="flex items-center mb-6">
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
            <h2 className="text-2xl font-bold text-white">Terrain Settings</h2>
            <p className="text-gray-300">
              Configure map generation for "{gameData.gameName}"
            </p>
          </div>
        </div>

        <form onSubmit={handleCreateGame} className="space-y-6">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label
                htmlFor="generator"
                className="block text-sm font-medium text-gray-300 mb-2"
              >
                Map Generator
              </label>
              <select
                id="generator"
                value={terrainSettings.generator}
                onChange={e =>
                  setTerrainSettings(prev => ({
                    ...prev,
                    generator: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              >
                {generatorOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                {
                  generatorOptions.find(
                    opt => opt.value === terrainSettings.generator
                  )?.description
                }
              </p>
            </div>

            <div>
              <label
                htmlFor="landmass"
                className="block text-sm font-medium text-gray-300 mb-2"
              >
                Landmass
              </label>
              <select
                id="landmass"
                value={terrainSettings.landmass}
                onChange={e =>
                  setTerrainSettings(prev => ({
                    ...prev,
                    landmass: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              >
                {landmassOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                {
                  landmassOptions.find(
                    opt => opt.value === terrainSettings.landmass
                  )?.description
                }
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Temperature: {terrainSettings.temperature}% (Cooler ← → Warmer)
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={terrainSettings.temperature}
              onChange={e =>
                setTerrainSettings(prev => ({
                  ...prev,
                  temperature: parseInt(e.target.value),
                }))
              }
              className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-green-500"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>Arctic</span>
              <span>Temperate</span>
              <span>Tropical</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Wetness: {terrainSettings.wetness}% (Drier ← → Wetter)
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={terrainSettings.wetness}
              onChange={e =>
                setTerrainSettings(prev => ({
                  ...prev,
                  wetness: parseInt(e.target.value),
                }))
              }
              className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-green-500"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>Desert</span>
              <span>Normal</span>
              <span>Jungle</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Rivers: {terrainSettings.rivers}%
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={terrainSettings.rivers}
              onChange={e =>
                setTerrainSettings(prev => ({
                  ...prev,
                  rivers: parseInt(e.target.value),
                }))
              }
              className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-green-500"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>Few Rivers</span>
              <span>Many Rivers</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <label
                htmlFor="huts"
                className="block text-sm font-medium text-gray-300 mb-2"
              >
                Huts (Villages)
              </label>
              <input
                id="huts"
                type="number"
                min="0"
                max="50"
                value={terrainSettings.huts}
                onChange={e =>
                  setTerrainSettings(prev => ({
                    ...prev,
                    huts: parseInt(e.target.value),
                  }))
                }
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-400 mt-1">
                Number of tribal villages on map
              </p>
            </div>

            <div>
              <label
                htmlFor="resources"
                className="block text-sm font-medium text-gray-300 mb-2"
              >
                Resources
              </label>
              <select
                id="resources"
                value={terrainSettings.resources}
                onChange={e =>
                  setTerrainSettings(prev => ({
                    ...prev,
                    resources: e.target.value,
                  }))
                }
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              >
                {resourceOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                {
                  resourceOptions.find(
                    opt => opt.value === terrainSettings.resources
                  )?.description
                }
              </p>
            </div>
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
            >
              Back
            </button>
            <button
              type="submit"
              disabled={isCreating}
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
