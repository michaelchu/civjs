import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { gameClient } from '../services/GameClient';
import { PageBackground } from './shared/PageBackground';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './ui/card';
import { Combobox } from './ui/combobox';
import { Slider } from './ui/slider';
import { Button } from './ui/button';

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
    { value: 'random', label: 'Default Random' },
    { value: 'fractal', label: 'Fractal' },
    { value: 'island', label: 'Islands' },
    { value: 'fair', label: 'Fair islands' },
    { value: 'fracture', label: 'Fracture' },
  ];

  const generatorDescriptions = {
    random: 'Standard random terrain generation',
    fractal: 'Realistic continent shapes using height maps',
    island: 'Many small islands and varied landmasses',
    fair: 'Large continent with fair starting positions',
    fracture: 'Fractured landmasses with complex coastlines',
  };

  const landmassOptions = [
    { value: 'sparse', label: 'Sparse (30%)' },
    { value: 'normal', label: 'Normal (50%)' },
    { value: 'dense', label: 'Dense (70%)' },
  ];

  const landmassDescriptions = {
    sparse: 'Lots of water',
    normal: 'Balanced land/water',
    dense: 'Mostly land',
  };

  const resourceOptions = [
    { value: 'sparse', label: 'Sparse' },
    { value: 'normal', label: 'Normal' },
    { value: 'abundant', label: 'Abundant' },
  ];

  const resourceDescriptions = {
    sparse: 'Few strategic resources',
    normal: 'Balanced resources',
    abundant: 'Many resources',
  };

  const startposOptions = [
    { value: '0', label: "Generator's Choice" },
    { value: '1', label: 'One per Continent' },
    { value: '2', label: 'Two on Three per Continent' },
    { value: '3', label: 'All on Single Continent' },
    { value: '4', label: 'Variable Distribution' },
  ];

  const startposDescriptions = {
    0: 'Let the generator decide player placement',
    1: 'Each player starts on their own continent',
    2: 'Two on three players per continent',
    3: 'All players start on the same landmass',
    4: 'Distribution depends on continent sizes',
  };

  return (
    <PageBackground className="min-h-[100dvh] md:flex md:items-center md:justify-center md:p-4">
      <div className="flex flex-col h-[100dvh] md:h-auto md:max-w-4xl xl:max-w-5xl md:mx-auto min-h-0">
        <Card className="bg-transparent md:bg-card md:shadow-2xl w-full flex-1 md:flex-none overflow-y-auto">
          <CardHeader>
            <div className="flex items-center">
              <button
                onClick={handleBack}
                className="mr-3 p-2 text-muted-foreground hover:text-foreground transition-colors"
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
                <CardTitle className="text-2xl">Terrain Settings</CardTitle>
                <CardDescription className="text-sm md:text-base">
                  Configure map generation for "{gameData.gameName}"
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            <form
              id="terrain-settings-form"
              onSubmit={handleCreateGame}
              className="space-y-4 md:space-y-6"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                <div>
                  <label
                    htmlFor="generator"
                    className="block text-sm font-medium text-foreground mb-2"
                  >
                    Map Generator
                  </label>
                  <Combobox
                    options={generatorOptions}
                    value={terrainSettings.generator}
                    onValueChange={value =>
                      setTerrainSettings(prev => ({ ...prev, generator: value }))
                    }
                    placeholder="Select map generator"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {
                      generatorDescriptions[
                        terrainSettings.generator as keyof typeof generatorDescriptions
                      ]
                    }
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="landmass"
                    className="block text-sm font-medium text-foreground mb-2"
                  >
                    Landmass
                  </label>
                  <Combobox
                    options={landmassOptions}
                    value={terrainSettings.landmass}
                    onValueChange={value =>
                      setTerrainSettings(prev => ({ ...prev, landmass: value }))
                    }
                    placeholder="Select landmass type"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {
                      landmassDescriptions[
                        terrainSettings.landmass as keyof typeof landmassDescriptions
                      ]
                    }
                  </p>
                </div>
              </div>

              {/* Sliders in responsive grid layout */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Temperature
                  </label>
                  <div className="inline-flex w-full -space-x-px rounded-md shadow-xs rtl:space-x-reverse">
                    <Button
                      type="button"
                      variant={terrainSettings.temperature === 35 ? 'default' : 'outline'}
                      className="flex-1 rounded-none rounded-s-md shadow-none focus-visible:z-10"
                      onClick={() => setTerrainSettings(prev => ({ ...prev, temperature: 35 }))}
                    >
                      Cold
                    </Button>
                    <Button
                      type="button"
                      variant={terrainSettings.temperature === 50 ? 'default' : 'outline'}
                      className="flex-1 rounded-none shadow-none focus-visible:z-10"
                      onClick={() => setTerrainSettings(prev => ({ ...prev, temperature: 50 }))}
                    >
                      Temperate
                    </Button>
                    <Button
                      type="button"
                      variant={terrainSettings.temperature === 75 ? 'default' : 'outline'}
                      className="flex-1 rounded-none rounded-e-md shadow-none focus-visible:z-10"
                      onClick={() => setTerrainSettings(prev => ({ ...prev, temperature: 75 }))}
                    >
                      Tropical
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 min-h-[16px]">
                    {terrainSettings.temperature === 35 && 'More tundra and cold regions'}
                    {terrainSettings.temperature === 50 && 'Balanced climate with varied terrains'}
                    {terrainSettings.temperature === 75 && 'More jungles and tropical regions'}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Wetness</label>
                  <div className="inline-flex w-full -space-x-px rounded-md shadow-xs rtl:space-x-reverse">
                    <Button
                      type="button"
                      variant={terrainSettings.wetness === 35 ? 'default' : 'outline'}
                      className="flex-1 rounded-none rounded-s-md shadow-none focus-visible:z-10"
                      onClick={() => setTerrainSettings(prev => ({ ...prev, wetness: 35 }))}
                    >
                      Dry
                    </Button>
                    <Button
                      type="button"
                      variant={terrainSettings.wetness === 50 ? 'default' : 'outline'}
                      className="flex-1 rounded-none shadow-none focus-visible:z-10"
                      onClick={() => setTerrainSettings(prev => ({ ...prev, wetness: 50 }))}
                    >
                      Normal
                    </Button>
                    <Button
                      type="button"
                      variant={terrainSettings.wetness === 75 ? 'default' : 'outline'}
                      className="flex-1 rounded-none rounded-e-md shadow-none focus-visible:z-10"
                      onClick={() => setTerrainSettings(prev => ({ ...prev, wetness: 75 }))}
                    >
                      Wet
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {terrainSettings.wetness === 35 && 'More deserts and dry regions'}
                    {terrainSettings.wetness === 50 && 'Balanced moisture with varied terrains'}
                    {terrainSettings.wetness === 75 && 'More forests, rivers, and swamps'}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">Rivers</label>
                  <div className="inline-flex w-full -space-x-px rounded-md shadow-xs rtl:space-x-reverse">
                    <Button
                      type="button"
                      variant={terrainSettings.rivers === 35 ? 'default' : 'outline'}
                      className="flex-1 rounded-none rounded-s-md shadow-none focus-visible:z-10"
                      onClick={() => setTerrainSettings(prev => ({ ...prev, rivers: 35 }))}
                    >
                      Few
                    </Button>
                    <Button
                      type="button"
                      variant={terrainSettings.rivers === 50 ? 'default' : 'outline'}
                      className="flex-1 rounded-none shadow-none focus-visible:z-10"
                      onClick={() => setTerrainSettings(prev => ({ ...prev, rivers: 50 }))}
                    >
                      Normal
                    </Button>
                    <Button
                      type="button"
                      variant={terrainSettings.rivers === 75 ? 'default' : 'outline'}
                      className="flex-1 rounded-none rounded-e-md shadow-none focus-visible:z-10"
                      onClick={() => setTerrainSettings(prev => ({ ...prev, rivers: 75 }))}
                    >
                      Many
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {terrainSettings.rivers === 35 && 'Fewer rivers and waterways'}
                    {terrainSettings.rivers === 50 && 'Balanced river distribution'}
                    {terrainSettings.rivers === 75 && 'More rivers and waterways'}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Huts: {terrainSettings.huts} (Villages)
                  </label>
                  <Slider
                    value={[terrainSettings.huts]}
                    onValueChange={([value]) =>
                      setTerrainSettings(prev => ({ ...prev, huts: value }))
                    }
                    max={50}
                    min={0}
                    step={1}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>None</span>
                    <span>Many Villages</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                <div>
                  <label
                    htmlFor="resources"
                    className="block text-sm font-medium text-foreground mb-2"
                  >
                    Resources
                  </label>
                  <Combobox
                    options={resourceOptions}
                    value={terrainSettings.resources}
                    onValueChange={value =>
                      setTerrainSettings(prev => ({ ...prev, resources: value }))
                    }
                    placeholder="Select resource level"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {
                      resourceDescriptions[
                        terrainSettings.resources as keyof typeof resourceDescriptions
                      ]
                    }
                  </p>
                </div>
              </div>

              {/* Startpos setting - only show for island-based generators */}
              {(terrainSettings.generator === 'island' || terrainSettings.generator === 'fair') && (
                <div>
                  <label
                    htmlFor="startpos"
                    className="block text-sm font-medium text-foreground mb-2"
                  >
                    Starting Positions
                  </label>
                  <Combobox
                    options={startposOptions}
                    value={terrainSettings.startpos?.toString()}
                    onValueChange={value =>
                      setTerrainSettings(prev => ({ ...prev, startpos: parseInt(value) }))
                    }
                    placeholder="Select starting positions"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {
                      startposDescriptions[
                        terrainSettings.startpos as keyof typeof startposDescriptions
                      ]
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
                  className="flex-1 py-3 px-4 bg-secondary hover:bg-secondary/80 text-secondary-foreground font-medium rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 shadow-sm"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="flex-1 py-3 px-4 bg-primary hover:bg-primary/90 disabled:bg-primary/50 disabled:text-primary-foreground/50 text-primary-foreground font-medium rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 shadow-sm"
                >
                  {isCreating ? (
                    <div className="flex items-center justify-center">
                      <div className="animate-spin w-5 h-5 border-2 border-primary-foreground/30 border-t-transparent rounded-full mr-2"></div>
                      Creating...
                    </div>
                  ) : (
                    'Create Game'
                  )}
                </button>
              </div>
            </form>
          </CardContent>

          <CardFooter className="lg:hidden border-t border-border mt-auto">
            <div className="flex space-x-4 w-full">
              <button
                type="button"
                onClick={handleBack}
                className="flex-1 py-3 px-4 bg-secondary hover:bg-secondary/80 text-secondary-foreground font-medium rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 shadow-sm"
              >
                Back
              </button>
              <button
                type="submit"
                form="terrain-settings-form"
                disabled={isCreating}
                className="flex-1 py-3 px-4 bg-primary hover:bg-primary/90 disabled:bg-primary/50 disabled:text-primary-foreground/50 text-primary-foreground font-medium rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 shadow-sm"
              >
                {isCreating ? (
                  <div className="flex items-center justify-center">
                    <div className="animate-spin w-5 h-5 border-2 border-primary-foreground/30 border-t-transparent rounded-full mr-2"></div>
                    Creating...
                  </div>
                ) : (
                  'Create Game'
                )}
              </button>
            </div>
          </CardFooter>
        </Card>
      </div>
    </PageBackground>
  );
};
