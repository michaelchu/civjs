import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { gameClient } from '../services/GameClient';
import { PageBackground } from './shared/PageBackground';

interface GameCreationState {
  playerName: string;
  gameName: string;
  gameType: 'single' | 'multiplayer';
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
  startpos?: number; // MapStartpos enum value for island generator routing
}

export const TerrainSettingsDialog: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const [terrainSettings, setTerrainSettings] = useState<TerrainSettings>({
    generator: 'random',
    landmass: 'normal',
    huts: 15,
    temperature: 50,
    wetness: 50,
    rivers: 50,
    resources: 'normal',
    startpos: 0, // Default = Generator's choice
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
        gameType: gameData.gameType,
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
      value: 'random',
      label: 'Default Random',
      description: 'Standard random terrain generation',
    },
    {
      value: 'fractal',
      label: 'Fractal',
      description: 'Realistic continent shapes using height maps',
    },
    {
      value: 'island',
      label: 'Islands',
      description: 'Many small islands and varied landmasses',
    },
    {
      value: 'fair',
      label: 'Fair islands',
      description: 'Large continent with fair starting positions',
    },
    {
      value: 'fracture',
      label: 'Fracture',
      description: 'Fractured landmasses with complex coastlines',
    },
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

  const startposOptions = [
    {
      value: 0,
      label: "Generator's Choice",
      description: 'Let the generator decide player placement',
    },
    {
      value: 1,
      label: 'One per Continent',
      description: 'Each player starts on their own continent',
    },
    {
      value: 2,
      label: 'Two on Three per Continent',
      description: 'Two on three players per continent',
    },
    {
      value: 3,
      label: 'All on Single Continent',
      description: 'All players start on the same landmass',
    },
    {
      value: 4,
      label: 'Variable Distribution',
      description: 'Distribution depends on continent sizes',
    },
  ];

  return (
    <PageBackground
      className="min-h-[100dvh] lg:flex lg:items-center lg:justify-center"
      mobileBreakpoint="lg"
    >
      <div className="flex flex-col h-[100dvh] lg:h-auto lg:max-w-4xl xl:max-w-5xl lg:mx-auto min-h-0">
        <div className="bg-transparent lg:bg-gradient-to-b lg:from-amber-100 lg:to-yellow-100 p-4 lg:p-8 lg:rounded-lg lg:shadow-2xl w-full lg:border lg:border-amber-300 lg:shadow-amber-300/20 flex-1 lg:flex-none overflow-y-auto">
          <div className="flex items-center mb-6">
            <button
              onClick={handleBack}
              className="mr-3 p-2 text-amber-600 hover:text-amber-800 transition-colors"
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
              <h2 className="text-xl md:text-2xl font-bold text-amber-800">
                Terrain Settings
              </h2>
              <p className="text-amber-600 text-sm md:text-base">
                Configure map generation for "{gameData.gameName}"
              </p>
            </div>
          </div>

          <form
            id="terrain-settings-form"
            onSubmit={handleCreateGame}
            className="space-y-4 md:space-y-6"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              <div>
                <label
                  htmlFor="generator"
                  className="block text-sm font-medium text-amber-700 mb-2"
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
                  className="w-full px-3 py-3 bg-amber-50 border border-amber-400 rounded-md text-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-600 focus:border-amber-600 shadow-sm"
                >
                  {generatorOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-amber-500 mt-1">
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
                  className="block text-sm font-medium text-amber-700 mb-2"
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
                  className="w-full px-3 py-3 bg-amber-50 border border-amber-400 rounded-md text-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-600 focus:border-amber-600 shadow-sm"
                >
                  {landmassOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-amber-500 mt-1">
                  {
                    landmassOptions.find(
                      opt => opt.value === terrainSettings.landmass
                    )?.description
                  }
                </p>
              </div>
            </div>

            {/* Sliders in responsive grid layout */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              <div>
                <label className="block text-sm font-medium text-amber-700 mb-2">
                  Temperature: {terrainSettings.temperature}% (Cooler ← →
                  Warmer)
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
                  className="w-full h-2 bg-amber-300 rounded-lg appearance-none cursor-pointer accent-amber-700"
                />
                <div className="flex justify-between text-xs text-amber-500 mt-1">
                  <span>Arctic</span>
                  <span>Temperate</span>
                  <span>Tropical</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-amber-700 mb-2">
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
                  className="w-full h-2 bg-amber-300 rounded-lg appearance-none cursor-pointer accent-amber-700"
                />
                <div className="flex justify-between text-xs text-amber-500 mt-1">
                  <span>Desert</span>
                  <span>Normal</span>
                  <span>Jungle</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-amber-700 mb-2">
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
                  className="w-full h-2 bg-amber-300 rounded-lg appearance-none cursor-pointer accent-amber-700"
                />
                <div className="flex justify-between text-xs text-amber-500 mt-1">
                  <span>Few Rivers</span>
                  <span>Many Rivers</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-amber-700 mb-2">
                  Huts: {terrainSettings.huts} (Villages)
                </label>
                <input
                  type="range"
                  min="0"
                  max="50"
                  value={terrainSettings.huts}
                  onChange={e =>
                    setTerrainSettings(prev => ({
                      ...prev,
                      huts: parseInt(e.target.value),
                    }))
                  }
                  className="w-full h-2 bg-amber-300 rounded-lg appearance-none cursor-pointer accent-amber-700"
                />
                <div className="flex justify-between text-xs text-amber-500 mt-1">
                  <span>None</span>
                  <span>Many Villages</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              <div>
                <label
                  htmlFor="resources"
                  className="block text-sm font-medium text-amber-700 mb-2"
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
                  className="w-full px-3 py-3 bg-amber-50 border border-amber-400 rounded-md text-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-600 focus:border-amber-600 shadow-sm"
                >
                  {resourceOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-amber-500 mt-1">
                  {
                    resourceOptions.find(
                      opt => opt.value === terrainSettings.resources
                    )?.description
                  }
                </p>
              </div>
            </div>

            {/* Startpos setting - only show for island-based generators */}
            {(terrainSettings.generator === 'island' ||
              terrainSettings.generator === 'fair') && (
              <div>
                <label
                  htmlFor="startpos"
                  className="block text-sm font-medium text-amber-700 mb-2"
                >
                  Starting Positions
                </label>
                <select
                  id="startpos"
                  value={terrainSettings.startpos}
                  onChange={e =>
                    setTerrainSettings(prev => ({
                      ...prev,
                      startpos: parseInt(e.target.value),
                    }))
                  }
                  className="w-full px-3 py-3 bg-amber-50 border border-amber-400 rounded-md text-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-600 focus:border-amber-600 shadow-sm"
                >
                  {startposOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-amber-500 mt-1">
                  {
                    startposOptions.find(
                      opt => opt.value === terrainSettings.startpos
                    )?.description
                  }
                </p>
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-50 border border-red-300 rounded-md text-red-800 text-sm">
                {error}
              </div>
            )}

            <div className="hidden lg:flex flex-col lg:flex-row space-y-3 lg:space-y-0 lg:space-x-4">
              <button
                type="button"
                onClick={handleBack}
                className="flex-1 py-3 px-4 bg-amber-300 hover:bg-amber-400 text-amber-700 font-medium rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-amber-600 focus:ring-offset-2 focus:ring-offset-amber-100 shadow-sm"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={isCreating}
                className="flex-1 py-3 px-4 bg-amber-700 hover:bg-amber-800 disabled:bg-amber-400 disabled:text-amber-200 text-amber-50 font-medium rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-amber-600 focus:ring-offset-2 focus:ring-offset-amber-100 shadow-sm"
              >
                {isCreating ? (
                  <div className="flex items-center justify-center">
                    <div className="animate-spin w-5 h-5 border-2 border-amber-300 border-t-transparent rounded-full mr-2"></div>
                    Creating...
                  </div>
                ) : (
                  'Create Game'
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Mobile bottom buttons */}
        <div className="lg:hidden bg-gradient-to-t from-amber-100 to-transparent p-4 border-t border-amber-300 mt-auto">
          <div className="flex space-x-4">
            <button
              type="button"
              onClick={handleBack}
              className="flex-1 py-3 px-4 bg-amber-300 hover:bg-amber-400 text-amber-700 font-medium rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-amber-600 focus:ring-offset-2 focus:ring-offset-amber-100 shadow-sm"
            >
              Back
            </button>
            <button
              type="submit"
              form="terrain-settings-form"
              disabled={isCreating}
              className="flex-1 py-3 px-4 bg-amber-700 hover:bg-amber-800 disabled:bg-amber-400 disabled:text-amber-200 text-amber-50 font-medium rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-amber-600 focus:ring-offset-2 focus:ring-offset-amber-100 shadow-sm"
            >
              {isCreating ? (
                <div className="flex items-center justify-center">
                  <div className="animate-spin w-5 h-5 border-2 border-amber-300 border-t-transparent rounded-full mr-2"></div>
                  Creating...
                </div>
              ) : (
                'Create Game'
              )}
            </button>
          </div>
        </div>
      </div>
    </PageBackground>
  );
};
