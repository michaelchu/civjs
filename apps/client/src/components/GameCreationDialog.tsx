import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageBackground } from './shared/PageBackground';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './ui/card';
import { Input } from './ui/input';
import { Combobox } from './ui/combobox';
import { useNationSelection } from '../hooks/useNations';
import { useGameCreationStore } from '../store/gameCreationStore';

export const GameCreationDialog: React.FC = () => {
  const { formData, updateFormData, resetAll, _hasHydrated } = useGameCreationStore();
  const [error, setError] = useState('');

  // Fetch nations using our hook
  const { nations, loading: nationsLoading, error: nationsError } = useNationSelection('classic');

  const navigate = useNavigate();

  // Log errors for debugging
  useEffect(() => {
    if (nationsError) {
      console.error('Failed to fetch nations:', nationsError);
    }
  }, [nationsError]);

  // Wait for hydration before rendering
  if (!_hasHydrated) {
    return (
      <PageBackground>
        <Card className="w-full max-w-4xl mx-auto mt-8 mb-8 shadow-2xl bg-gray-800/95 border-gray-700">
          <CardContent className="flex items-center justify-center py-10">
            <div className="text-gray-400">Loading...</div>
          </CardContent>
        </Card>
      </PageBackground>
    );
  }

  // Destructure form data for easier access
  const { playerName, gameName, gameType, maxPlayers, mapSize, selectedNation } = formData;

  const handleBack = () => {
    // Clear the stored form data when canceling
    resetAll();
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

    if (!selectedNation) {
      setError('Please select a nation');
      return;
    }

    // Update the store with final values before navigation
    updateFormData({
      playerName: playerName.trim(),
      gameName: gameName.trim(),
      gameType,
      maxPlayers: gameType === 'single' ? 1 : maxPlayers,
      mapSize,
      selectedNation,
    });

    // Navigate to terrain settings
    navigate('/terrain-settings');
  };

  const mapSizeOptions = [
    { value: 'small', label: 'Small (40x25)' },
    { value: 'standard', label: 'Standard (80x50)' },
  ];

  const gameTypeOptions = [
    { value: 'single', label: 'Single Player' },
    { value: 'multiplayer', label: 'Multiplayer (Coming Soon)', disabled: true },
  ];

  const maxPlayersOptions = [
    { value: '2', label: '2 Players' },
    { value: '3', label: '3 Players' },
    { value: '4', label: '4 Players' },
    { value: '6', label: '6 Players' },
    { value: '8', label: '8 Players' },
  ];

  // Create nation options from the fetched nations
  const nationOptions = [
    { value: 'random', label: 'Random' },
    ...nations.map(nation => ({
      value: nation.id,
      label: nation.name,
    })),
  ];

  return (
    <PageBackground className="min-h-[100dvh] md:flex md:items-center md:justify-center md:p-4">
      <div className="flex flex-col h-[100dvh] md:h-auto md:max-w-2xl xl:max-w-3xl md:mx-auto">
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
                <CardTitle className="text-2xl">Create New Game</CardTitle>
                <CardDescription>Set up your civilization</CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            <form id="create-game-form" onSubmit={handleNext} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                <div>
                  <label
                    htmlFor="playerName"
                    className="block text-sm font-medium text-foreground mb-2"
                  >
                    Your Name
                  </label>
                  <Input
                    id="playerName"
                    type="text"
                    value={playerName}
                    onChange={e => updateFormData({ playerName: e.target.value })}
                    placeholder="Enter your player name"
                    maxLength={32}
                  />
                </div>

                <div>
                  <label
                    htmlFor="gameName"
                    className="block text-sm font-medium text-foreground mb-2"
                  >
                    Game Name
                  </label>
                  <Input
                    id="gameName"
                    type="text"
                    value={gameName}
                    onChange={e => updateFormData({ gameName: e.target.value })}
                    placeholder="Enter game name"
                    maxLength={50}
                  />
                </div>

                <div>
                  <label
                    htmlFor="nation"
                    className="block text-sm font-medium text-foreground mb-2"
                  >
                    Your Nation
                  </label>
                  <Combobox
                    options={nationOptions}
                    value={selectedNation}
                    onValueChange={value => updateFormData({ selectedNation: value })}
                    placeholder={nationsLoading ? 'Loading nations...' : 'Select your nation'}
                    disabled={nationsLoading}
                  />
                  {nationsError && (
                    <p className="text-xs text-red-500 mt-1">
                      Failed to load nations. Please refresh the page.
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="gameType"
                    className="block text-sm font-medium text-foreground mb-2"
                  >
                    Game Type
                  </label>
                  <Combobox
                    options={gameTypeOptions}
                    value={gameType}
                    onValueChange={value =>
                      updateFormData({ gameType: value as 'single' | 'multiplayer' })
                    }
                    placeholder="Select game type"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {gameType === 'single'
                      ? 'Play against AI opponents'
                      : 'Play with other human players online'}
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="mapSize"
                    className="block text-sm font-medium text-foreground mb-2"
                  >
                    Map Size
                  </label>
                  <Combobox
                    options={mapSizeOptions}
                    value={mapSize}
                    onValueChange={value => updateFormData({ mapSize: value })}
                    placeholder="Select map size"
                  />
                </div>
              </div>

              {gameType === 'multiplayer' && (
                <div>
                  <label
                    htmlFor="maxPlayers"
                    className="block text-sm font-medium text-foreground mb-2"
                  >
                    Max Players
                  </label>
                  <Combobox
                    options={maxPlayersOptions}
                    value={maxPlayers.toString()}
                    onValueChange={value => updateFormData({ maxPlayers: Number(value) })}
                    placeholder="Select max players"
                    className="md:max-w-xs"
                  />
                </div>
              )}

              {error && (
                <div className="p-3 bg-red-50 border border-red-300 rounded-md text-red-800 text-sm">
                  {error}
                </div>
              )}

              <div className="hidden lg:flex space-x-4">
                <button
                  type="button"
                  onClick={handleBack}
                  className="flex-1 py-3 px-4 bg-secondary hover:bg-secondary/80 text-secondary-foreground font-medium rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 shadow-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={
                    !playerName.trim() || !gameName.trim() || !selectedNation || nationsLoading
                  }
                  className="flex-1 py-3 px-4 bg-primary hover:bg-primary/90 disabled:bg-primary/50 disabled:text-primary-foreground/50 text-primary-foreground font-medium rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 shadow-sm"
                >
                  Next
                </button>
              </div>
            </form>
          </CardContent>

          <CardFooter className="lg:hidden border-t border-border">
            <div className="flex space-x-4 w-full">
              <button
                type="button"
                onClick={handleBack}
                className="flex-1 py-3 px-4 bg-secondary hover:bg-secondary/80 text-secondary-foreground font-medium rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 shadow-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="create-game-form"
                disabled={
                  !playerName.trim() || !gameName.trim() || !selectedNation || nationsLoading
                }
                className="flex-1 py-3 px-4 bg-primary hover:bg-primary/90 disabled:bg-primary/50 disabled:text-primary-foreground/50 text-primary-foreground font-medium rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 shadow-sm"
              >
                Next
              </button>
            </div>
          </CardFooter>
        </Card>
      </div>
    </PageBackground>
  );
};
